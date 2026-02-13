import { env } from "../env.ts";
import { resolveNamespaces, type NamespaceSource } from "./namespace.ts";
import type { NamespaceConfig, PipelineConfig } from "./types.ts";
import { errorMessage } from "../types.ts";
import { logger } from "../logger.ts";
import { pipelineConfigSchema } from "./schema.ts";

const REFRESH_TTL_MS = 60_000;

let cachedConfigs: NamespaceConfig[] | null = null;
const lastRefreshed = new Map<string, number>();

function errorConfig(source: NamespaceSource, error: string): NamespaceConfig {
  return {
    namespace: source.namespace,
    display_name: source.namespace,
    aws_region: "",
    vars: {},
    pipelines: [],
    _source: { config: source.config, loaded_at: new Date().toISOString() },
    _error: error,
  };
}

export async function loadAllConfigs(force = false): Promise<NamespaceConfig[]> {
  if (cachedConfigs && !force) return cachedConfigs;

  const sources = resolveNamespaces();
  const results = await Promise.allSettled(sources.map(loadNamespaceConfig));

  cachedConfigs = results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;

    const source = sources[i]!;
    const msg = errorMessage(result.reason);
    logger.error({ namespace: source.namespace, config: source.config, error: msg }, "config load failed");
    return errorConfig(source, msg);
  });

  const ok = cachedConfigs.filter(c => !c._error).length;
  const failed = cachedConfigs.length - ok;
  logger.info({ loaded: ok, failed, total: cachedConfigs.length }, "configs loaded");

  return cachedConfigs;
}

export function getCachedConfigs(): NamespaceConfig[] | null {
  return cachedConfigs;
}

export async function refreshNamespace(ns: string): Promise<NamespaceConfig[]> {
  const lastTime = lastRefreshed.get(ns) ?? 0;
  if (Date.now() - lastTime < REFRESH_TTL_MS && cachedConfigs?.find(c => c.namespace === ns && !c._error)) {
    return cachedConfigs!;
  }

  const source = resolveNamespaces().find((s) => s.namespace === ns);
  if (!source) throw new Error(`Unknown namespace: ${ns}`);

  let updated: NamespaceConfig;
  try {
    updated = await loadNamespaceConfig(source);
  } catch (err) {
    const msg = errorMessage(err);
    logger.error({ namespace: ns, config: source.config, error: msg }, "config refresh failed");
    updated = errorConfig(source, msg);
  }
  lastRefreshed.set(ns, Date.now());

  cachedConfigs ??= [];
  const idx = cachedConfigs.findIndex((c) => c.namespace === ns);
  if (idx >= 0) cachedConfigs[idx] = updated;
  else cachedConfigs.push(updated);

  return cachedConfigs;
}

function toRawUrl(url: string): string {
  const m = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (!m) throw new Error(`Not a GitHub file URL: "${url}" — expected https://github.com/owner/repo/blob/branch/path`);
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
}

async function fetchConfigText(config: string): Promise<string> {
  if (config.startsWith("https://")) {
    const url = toRawUrl(config);
    const headers: Record<string, string> = {};
    if (env.GITHUB_TOKEN) headers.Authorization = `token ${env.GITHUB_TOKEN}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Failed to fetch config from ${config}: HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    }
    return res.text();
  }

  const file = Bun.file(config);
  if (!(await file.exists())) {
    throw new Error(`Config file not found: ${config}`);
  }
  return file.text();
}

async function loadNamespaceConfig(source: NamespaceSource): Promise<NamespaceConfig> {
  logger.info({ namespace: source.namespace, config: source.config }, "loading namespace config");
  const text = await fetchConfigText(source.config);
  const config = parseAndValidate(text, source.config);

  if (config.namespace !== source.namespace) {
    throw new Error(`Config namespace "${config.namespace}" does not match expected "${source.namespace}"`);
  }

  return {
    ...config,
    vars: config.vars ?? {},
    _source: {
      config: source.config,
      loaded_at: new Date().toISOString(),
    },
  };
}

function parseAndValidate(text: string, label: string): PipelineConfig {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
    if (Array.isArray(parsed)) {
      throw new Error("Multi-document YAML is not supported — config must be a single document");
    }
  } catch (err) {
    const msg = errorMessage(err);
    throw new Error(`Failed to parse config ${label}: ${msg}`);
  }

  const result = pipelineConfigSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `  ${i.path.join(".") || "/"}: ${i.message}`).join("\n");
    throw new Error(`Invalid config in ${label}:\n${errors}`);
  }

  return result.data;
}
