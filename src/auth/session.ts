import { env } from "../env.ts";
import { logger } from "../logger.ts";
import { errorMessage } from "../types.ts";

const SESSION_TTL_S = 24 * 60 * 60; // 24 hours
const COOKIE_NAME = "trigger_session";

export interface SessionPayload {
  email: string;
  name: string;
  groups: string[];
  exp: number;
}

export interface AuthSession {
  email: string;
  name: string;
  groups: string[];
  isSuperAdmin: boolean;
}

const encoder = new TextEncoder();

function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url: string): string {
  return atob(b64url.replace(/-/g, "+").replace(/_/g, "/"));
}

let cachedKey: CryptoKey | null = null;

async function getHmacKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = await crypto.subtle.importKey("raw", encoder.encode(env.OIDC_CLIENT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
  return cachedKey;
}

async function hmacSign(data: string): Promise<string> {
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return toBase64Url(btoa(String.fromCharCode(...new Uint8Array(sig))));
}

async function hmacVerify(data: string, signature: string): Promise<boolean> {
  const key = await getHmacKey();
  let sigBytes: Uint8Array;
  try {
    const decoded = fromBase64Url(signature);
    sigBytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) sigBytes[i] = decoded.charCodeAt(i);
  } catch {
    return false;
  }
  return crypto.subtle.verify("HMAC", key, sigBytes.buffer as ArrayBuffer, encoder.encode(data));
}

export async function signSession(user: { email: string; name: string; groups: string[] }): Promise<string> {
  const payload: SessionPayload = { ...user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S };
  const payloadB64 = toBase64Url(btoa(JSON.stringify(payload)));
  const signature = await hmacSign(payloadB64);
  return `${payloadB64}.${signature}`;
}

export async function verifySession(cookie: string): Promise<AuthSession | null> {
  const dotIndex = cookie.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const payloadB64 = cookie.slice(0, dotIndex);
  const signature = cookie.slice(dotIndex + 1);

  if (!(await hmacVerify(payloadB64, signature))) return null;

  try {
    const json = fromBase64Url(payloadB64);
    const payload = JSON.parse(json) as SessionPayload;

    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return {
      email: payload.email,
      name: payload.name,
      groups: payload.groups,
      isSuperAdmin: env.TRIGGER_ADMINS.includes(payload.email),
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

export async function getSession(req: Request): Promise<AuthSession | null> {
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
