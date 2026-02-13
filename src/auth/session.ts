import { env } from "../env.ts";

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

async function hmacSign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(env.OIDC_CLIENT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacVerify(data: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(data);
  return expected === signature;
}

export async function signSession(user: { email: string; name: string; groups: string[] }): Promise<string> {
  const payload: SessionPayload = {
    email: user.email,
    name: user.name,
    groups: user.groups,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S,
  };

  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const signature = await hmacSign(payloadB64);
  return `${payloadB64}.${signature}`;
}

export async function verifySession(cookie: string): Promise<AuthSession | null> {
  const dotIndex = cookie.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const payloadB64 = cookie.slice(0, dotIndex);
  const signature = cookie.slice(dotIndex + 1);

  if (!await hmacVerify(payloadB64, signature)) return null;

  try {
    const json = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as SessionPayload;

    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return {
      email: payload.email,
      name: payload.name,
      groups: payload.groups,
      isSuperAdmin: env.TRIGGER_ADMINS.includes(payload.email),
    };
  } catch {
    return null;
  }
}

export function getSessionCookie(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

export async function getSession(req: Request): Promise<AuthSession | null> {
  const cookie = getSessionCookie(req);
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
