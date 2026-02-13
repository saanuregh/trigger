import { env } from "../env.ts";
import { logger } from "../logger.ts";

interface OIDCConfig {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

let cachedConfig: OIDCConfig | null = null;

export async function fetchOIDCConfig(): Promise<OIDCConfig> {
  if (cachedConfig) return cachedConfig;

  const url = `${env.OIDC_ISSUER}/.well-known/openid-configuration`;
  logger.info({ url }, "fetching OIDC discovery");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);

  const data = await res.json() as Record<string, unknown>;
  cachedConfig = {
    authorization_endpoint: data.authorization_endpoint as string,
    token_endpoint: data.token_endpoint as string,
    userinfo_endpoint: data.userinfo_endpoint as string,
  };

  logger.info("OIDC discovery loaded");
  return cachedConfig;
}

export function getOIDCConfig(): OIDCConfig | null {
  return cachedConfig;
}

export function getAuthUrl(state: string, redirectUri: string): string {
  const config = cachedConfig;
  if (!config) throw new Error("OIDC not initialized");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.OIDC_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid email profile groups",
    state,
  });

  return `${config.authorization_endpoint}?${params}`;
}

export interface OIDCUser {
  email: string;
  name: string;
  groups: string[];
}

export async function exchangeCode(code: string, redirectUri: string): Promise<OIDCUser> {
  const config = cachedConfig;
  if (!config) throw new Error("OIDC not initialized");

  const res = await fetch(config.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.OIDC_CLIENT_ID,
      client_secret: env.OIDC_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${body}`);
  }

  const tokens = await res.json() as { id_token?: string; access_token?: string };

  // Decode ID token (JWT) — no signature verification needed since we got it
  // directly from the token endpoint over HTTPS (standard OIDC practice for
  // confidential clients using the authorization code flow).
  if (!tokens.id_token) throw new Error("No id_token in token response");

  const payload = JSON.parse(
    Buffer.from(tokens.id_token.split(".")[1]!, "base64url").toString(),
  ) as Record<string, unknown>;

  return {
    email: (payload.email as string) ?? "",
    name: (payload.name as string) ?? (payload.preferred_username as string) ?? "",
    groups: Array.isArray(payload.groups) ? payload.groups as string[] : [],
  };
}
