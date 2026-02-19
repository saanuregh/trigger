import { authed } from "../../auth/access.ts";
import { exchangeCode, getAuthUrl, getOIDCConfig } from "../../auth/oidc.ts";
import { clearSessionCookie, getCookie, sessionCookieHeader, signSession } from "../../auth/session.ts";
import { env } from "../../env.ts";
import { logger } from "../../logger.ts";
import { type AuthInfoResponse, errorMessage, type OkResponse, type UserResponse } from "../../types.ts";
import { OAUTH_STATE_COOKIE, type RouteRequest } from "./helpers.ts";

const SECURE_SUFFIX = env.development ? "" : "; Secure";

function safeReturnUrl(url: string): string {
  return url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

export const info = () => Response.json({ enabled: env.authEnabled } satisfies AuthInfoResponse);

export const login = (req: RouteRequest) => {
  if (!env.authEnabled || !getOIDCConfig()) {
    return Response.json({ error: "Auth not configured" }, { status: 501 });
  }

  const url = new URL(req.url);
  const returnUrl = safeReturnUrl(url.searchParams.get("return") ?? "/");
  const state = btoa(JSON.stringify({ returnUrl, nonce: crypto.randomUUID() }));

  const redirectUri = `${url.origin}/auth/callback`;
  const authUrl = getAuthUrl(state, redirectUri);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `${OAUTH_STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${SECURE_SUFFIX}`,
    },
  });
};

export const callback = async (req: RouteRequest) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return new Response(null, { status: 302, headers: { Location: "/login?error=missing_params" } });
  }

  const savedState = getCookie(req, OAUTH_STATE_COOKIE);
  if (savedState !== state) {
    return new Response(null, { status: 302, headers: { Location: "/login?error=invalid_state" } });
  }

  try {
    const redirectUri = `${url.origin}/auth/callback`;
    const user = await exchangeCode(code, redirectUri);
    const sessionCookie = signSession(user);

    let returnUrl = "/";
    try {
      returnUrl = safeReturnUrl((JSON.parse(atob(state)).returnUrl as string) ?? "/");
    } catch {
      logger.warn("failed to parse returnUrl from OAuth state, defaulting to /");
    }

    logger.info({ email: user.email, groups: user.groups }, "user authenticated");

    return new Response(null, {
      status: 302,
      headers: [
        ["Location", returnUrl],
        ["Set-Cookie", sessionCookieHeader(sessionCookie)],
        ["Set-Cookie", `${OAUTH_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE_SUFFIX}`],
      ],
    });
  } catch (err) {
    logger.error({ error: errorMessage(err) }, "auth callback failed");
    return new Response(null, { status: 302, headers: { Location: "/login?error=auth_failed" } });
  }
};

export const me = authed(async (_req, session) => {
  return Response.json({
    email: session.email,
    name: session.name,
    groups: session.groups,
    isSuperAdmin: session.isSuperAdmin,
  } satisfies UserResponse);
});

export const logout = (_req: RouteRequest) => {
  return Response.json({ ok: true } satisfies OkResponse, { headers: { "Set-Cookie": clearSessionCookie() } });
};
