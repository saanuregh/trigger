function required(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return Bun.env[name] ?? fallback;
}

const NODE_ENV = optional("NODE_ENV", "development");

const OIDC_ISSUER = optional("OIDC_ISSUER", "");

export const env = {
  NODE_ENV,
  development: NODE_ENV !== "production",
  PORT: Number(optional("PORT", "3000")),
  DATA_DIR: optional("DATA_DIR", "./data"),

  CLOUDFLARE_API_TOKEN: optional("CLOUDFLARE_API_TOKEN", ""),
  CLOUDFLARE_ZONE_ID: optional("CLOUDFLARE_ZONE_ID", ""),
  GITHUB_TOKEN: optional("GITHUB_TOKEN", ""),
  TRIGGER_NAMESPACES: required("TRIGGER_NAMESPACES")
    .split(",")
    .map((s) => s.trim()),
  namespaceConfig(ns: string) {
    return required(`TRIGGER_${ns.toUpperCase()}_CONFIG`);
  },

  // Auth (opt-in: set OIDC_ISSUER to enable)
  OIDC_ISSUER,
  OIDC_CLIENT_ID: optional("OIDC_CLIENT_ID", ""),
  OIDC_CLIENT_SECRET: optional("OIDC_CLIENT_SECRET", ""),
  TRIGGER_ADMINS: optional("TRIGGER_ADMINS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  get authEnabled() {
    return OIDC_ISSUER !== "";
  },
} as const;
