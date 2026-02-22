import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import { errorMessage } from "../types.ts";

const SESSION_TTL_S = 24 * 60 * 60; // 24 hours
const COOKIE_NAME = "trigger_session";

const sessionPayloadSchema = z.object({
  email: z.string(),
  name: z.string(),
  groups: z.array(z.string()),
  exp: z.number(),
});

type SessionPayload = z.infer<typeof sessionPayloadSchema>;

export interface AuthSession {
  email: string;
  name: string;
  groups: string[];
  isSuperAdmin: boolean;
}

function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getSigningKey(): string {
  const key = env.SESSION_SECRET || env.OIDC_CLIENT_SECRET;
  if (!key) throw new Error("Cannot sign session: SESSION_SECRET or OIDC_CLIENT_SECRET must be set");
  return key;
}

function hmacSign(data: string): string {
  return toBase64Url(new Bun.CryptoHasher("sha256", getSigningKey()).update(data).digest("base64"));
}

export { hmacSign, hmacVerify };

function hmacVerify(data: string, signature: string): boolean {
  const expected = hmacSign(data);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function signSession(user: { email: string; name: string; groups: string[] }): string {
  const payload: SessionPayload = { ...user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S };
  const payloadB64 = toBase64Url(btoa(JSON.stringify(payload)));
  return `${payloadB64}.${hmacSign(payloadB64)}`;
}

export function verifySession(cookie: string): AuthSession | null {
  const dotIndex = cookie.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const payloadB64 = cookie.slice(0, dotIndex);
  const signature = cookie.slice(dotIndex + 1);

  if (!hmacVerify(payloadB64, signature)) return null;

  try {
    const json = fromBase64Url(payloadB64);
    const result = sessionPayloadSchema.safeParse(JSON.parse(json));

    if (!result.success) return null;

    const payload = result.data;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return {
      email: payload.email,
      name: payload.name,
      groups: payload.groups,
      isSuperAdmin: env.TRIGGER_ADMINS.some((a) => a.toLowerCase() === payload.email.toLowerCase()),
    };
  } catch (err) {
    if (err instanceof SyntaxError) return null; // malformed base64/JSON cookie
    logger.warn({ error: errorMessage(err) }, "unexpected error verifying session");
    return null;
  }
}

export function getCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function getSession(req: Request): AuthSession | null {
  const cookie = getCookie(req, COOKIE_NAME);
  if (!cookie) return null;
  return verifySession(cookie);
}

export function sessionCookieHeader(value: string, maxAge = SESSION_TTL_S): string {
  const secure = !env.development ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookie(): string {
  return sessionCookieHeader("", 0);
}
