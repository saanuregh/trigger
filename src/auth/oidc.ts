import { z } from "zod";
import { env } from "../env.ts";
import { logger } from "../logger.ts";

const oidcConfigSchema = z.object({
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  userinfo_endpoint: z.string(),
});

const oidcTokenResponseSchema = z.object({
  id_token: z.string(),
});

const oidcPayloadSchema = z.object({
  email: z.string().optional(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
  groups: z.array(z.unknown()).optional(),
});

type OIDCConfig = z.infer<typeof oidcConfigSchema>;

let cachedConfig: OIDCConfig | null = null;

export async function fetchOIDCConfig(): Promise<OIDCConfig> {
  if (cachedConfig) return cachedConfig;

  const url = `${env.OIDC_ISSUER}/.well-known/openid-configuration`;
  logger.info({ url }, "fetching OIDC discovery");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);

  const data = await res.json();
  const result = oidcConfigSchema.safeParse(data);

  if (!result.success) {
    throw new Error(`Invalid OIDC configuration: ${result.error.message}`);
  }

  cachedConfig = result.data;
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

  const tokens = await res.json();
  const tokenResult = oidcTokenResponseSchema.safeParse(tokens);

  if (!tokenResult.success) {
    throw new Error("No id_token in token response");
  }

  // Decode ID token (JWT) — no signature verification needed since we got it
  // directly from the token endpoint over HTTPS (standard OIDC practice for
  // confidential clients using the authorization code flow).
  const payload = JSON.parse(Buffer.from(tokenResult.data.id_token.split(".")[1]!, "base64url").toString());
  const payloadResult = oidcPayloadSchema.safeParse(payload);

  if (!payloadResult.success) {
    throw new Error(`Invalid JWT payload: ${payloadResult.error.message}`);
  }

  const user = payloadResult.data;
  return {
    email: user.email ?? "",
    name: user.name ?? user.preferred_username ?? "",
    groups: user.groups?.filter((g): g is string => typeof g === "string") ?? [],
  };
}
