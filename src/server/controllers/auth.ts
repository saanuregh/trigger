import { authed } from "../../auth/access.ts";
import { exchangeCode, getAuthUrl, getOIDCConfig } from "../../auth/oidc.ts";
import { clearSessionCookie, sessionCookieHeader, signSession } from "../../auth/session.ts";
import { env } from "../../env.ts";
import { logger } from "../../logger.ts";
import { errorMessage } from "../../types.ts";
import { OAUTH_STATE_COOKIE, type RouteRequest } from "./helpers.ts";

export const info = () => Response.json({ enabled: env.authEnabled });

export const login = (req: RouteRequest) => {
  if (!env.authEnabled || !getOIDCConfig()) {
    return Response.json({ error: "Auth not configured" }, { status: 501 });
  }

  const url = new URL(req.url);
  const returnUrl = url.searchParams.get("return") ?? "/";
  const state = btoa(JSON.stringify({ returnUrl, nonce: crypto.randomUUID() }));

  const redirectUri = `${url.origin}/auth/callback`;
  const authUrl = getAuthUrl(state, redirectUri);

  const secure = !env.development ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `${OAUTH_STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`,
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

  // Validate CSRF state
  const cookies = req.headers.get("cookie") ?? "";
  let savedState = "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === OAUTH_STATE_COOKIE) {
      savedState = rest.join("=");
      break;
    }
  }

  if (savedState !== state) {
    return new Response(null, { status: 302, headers: { Location: "/login?error=invalid_state" } });
  }

  try {
    const redirectUri = `${url.origin}/auth/callback`;
    const user = await exchangeCode(code, redirectUri);
    const sessionCookie = await signSession(user);
    const returnUrl = (JSON.parse(atob(state)).returnUrl as string) ?? "/";

    logger.info({ email: user.email, groups: user.groups }, "user authenticated");

    // Clear oauth state cookie + set session cookie
    const secure = !env.development ? "; Secure" : "";
    return new Response(null, {
      status: 302,
      headers: [
        ["Location", returnUrl],
        ["Set-Cookie", sessionCookieHeader(sessionCookie)],
        ["Set-Cookie", `${OAUTH_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`],
      ],
    });
  } catch (err) {
    logger.error({ error: errorMessage(err) }, "auth callback failed");
    return new Response(null, { status: 302, headers: { Location: "/login?error=auth_failed" } });
  }
};

export const me = authed(async (_req, session) => {
  return Response.json({ email: session.email, name: session.name, groups: session.groups, isSuperAdmin: session.isSuperAdmin });
});

export const logout = async (_req: RouteRequest) => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearSessionCookie(),
    },
  });
};
