function required(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return Bun.env[name] ?? fallback;
}

export const env = {
  get NODE_ENV() { return optional("NODE_ENV", "development"); },
  get development() { return env.NODE_ENV !== "production"; },
  get PORT() { return Number(optional("PORT", "3000")); },
  get DATA_DIR() { return optional("DATA_DIR", "./data"); },

  get CLOUDFLARE_API_TOKEN() { return optional("CLOUDFLARE_API_TOKEN", ""); },
  get CLOUDFLARE_ZONE_ID() { return optional("CLOUDFLARE_ZONE_ID", ""); },
  get GITHUB_TOKEN() { return optional("GITHUB_TOKEN", ""); },
  get TRIGGER_NAMESPACES() { return required("TRIGGER_NAMESPACES").split(",").map(s => s.trim()); },
  namespaceConfig(ns: string) {
    return required(`TRIGGER_${ns.toUpperCase()}_CONFIG`);
  },
} as const;
