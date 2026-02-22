function required(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return Bun.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number, { min }: { min?: number } = {}): number {
  const raw = Bun.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}: expected a number, got "${raw}"`);
  if (min !== undefined && n < min) throw new Error(`Invalid ${name}: must be >= ${min}, got ${n}`);
  return n;
}

const NODE_ENV = optional("NODE_ENV", "production");

const OIDC_ISSUER = optional("OIDC_ISSUER", "");

export const env = {
  NODE_ENV,
  development: NODE_ENV !== "production",
  PORT: optionalInt("PORT", 3000),
  DATA_DIR: optional("DATA_DIR", "./data"),
  ACTIONS_DIR: optional("ACTIONS_DIR", "./actions"),
  MAX_CONCURRENT_RUNS: optionalInt("MAX_CONCURRENT_RUNS", 10, { min: 1 }),
  LOG_RETENTION_DAYS: optionalInt("LOG_RETENTION_DAYS", 30, { min: 1 }),

  CLOUDFLARE_API_TOKEN: optional("CLOUDFLARE_API_TOKEN", ""),
  CLOUDFLARE_ZONE_ID: optional("CLOUDFLARE_ZONE_ID", ""),
  GITHUB_TOKEN: optional("GITHUB_TOKEN", ""),
  get TRIGGER_NAMESPACES(): string[] {
    return required("TRIGGER_NAMESPACES")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  namespaceConfig(ns: string) {
    return required(`TRIGGER_${ns.toUpperCase()}_CONFIG`);
  },

  // Auth (opt-in: set OIDC_ISSUER to enable)
  OIDC_ISSUER,
  OIDC_CLIENT_ID: optional("OIDC_CLIENT_ID", ""),
  OIDC_CLIENT_SECRET: optional("OIDC_CLIENT_SECRET", ""),
  SESSION_SECRET: optional("SESSION_SECRET", ""),
  TRIGGER_ENV_PREFIX: optional("TRIGGER_ENV_PREFIX", "TRIGGER_ENV_"),
  TRIGGER_ADMINS: optional("TRIGGER_ADMINS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  get authEnabled() {
    return OIDC_ISSUER !== "";
  },
} as const;
