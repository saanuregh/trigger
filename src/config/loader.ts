import type { z } from "zod";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import { getAllActionSchemas } from "../pipeline/action-registry.ts";
import { errorMessage } from "../types.ts";
import { type NamespaceSource, resolveNamespaces } from "./namespace.ts";
import { buildJSONSchema, buildSchema } from "./schema.ts";
import type { NamespaceConfig, PipelineConfig } from "./types.ts";

const REFRESH_TTL_MS = 60_000;

let cachedConfigs: NamespaceConfig[] | null = null;
const lastRefreshed = new Map<string, number>();
const refreshInFlight = new Map<string, Promise<NamespaceConfig[]>>();
let loadAllInFlight: Promise<NamespaceConfig[]> | null = null;

let activeSchema: z.ZodType | null = null;
let cachedJSONSchema: Record<string, unknown> | null = null;

export function rebuildConfigSchema(): void {
  const actions = getAllActionSchemas();
  activeSchema = buildSchema(actions);
  cachedJSONSchema = buildJSONSchema(activeSchema, actions);
  logger.info({ actions: actions.length }, "config schema built");
}

export function getActiveSchema(): z.ZodType {
  if (!activeSchema) throw new Error("Config schema not initialized — call rebuildConfigSchema() first");
  return activeSchema;
}

export function getJSONSchema(): Record<string, unknown> {
  if (!cachedJSONSchema) throw new Error("JSON schema not initialized — call rebuildConfigSchema() first");
  return cachedJSONSchema;
}

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
  if (loadAllInFlight && !force) return loadAllInFlight;

  const promise = (async () => {
    const sources = resolveNamespaces();
    const results = await Promise.allSettled(sources.map(loadNamespaceConfig));

    cachedConfigs = results.map((result, i) => {
      if (result.status === "fulfilled") return result.value;

      const source = sources[i]!;
      const msg = errorMessage(result.reason);
      logger.error({ namespace: source.namespace, config: source.config, error: msg }, "config load failed");
      return errorConfig(source, msg);
    });

    const ok = cachedConfigs.filter((c) => !c._error).length;
    const failed = cachedConfigs.length - ok;
    logger.info({ loaded: ok, failed, total: cachedConfigs.length }, "configs loaded");

    return cachedConfigs;
  })();

  loadAllInFlight = promise;
  try {
    return await promise;
  } finally {
    if (loadAllInFlight === promise) loadAllInFlight = null;
  }
}

export function getCachedConfigs(): NamespaceConfig[] | null {
  return cachedConfigs;
}

export async function refreshNamespace(ns: string): Promise<NamespaceConfig[]> {
  const isFresh = Date.now() - (lastRefreshed.get(ns) ?? 0) < REFRESH_TTL_MS;
  const hasCachedOk = cachedConfigs?.some((c) => c.namespace === ns && !c._error) ?? false;
  if (isFresh && hasCachedOk) return cachedConfigs!;

  if (loadAllInFlight) return loadAllInFlight;
  const existing = refreshInFlight.get(ns);
  if (existing) return existing;

  const promise = (async () => {
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
  })();

  refreshInFlight.set(ns, promise);
  try {
    return await promise;
  } finally {
    refreshInFlight.delete(ns);
  }
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
      throw new Error(
        `Failed to fetch config from ${config}: HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
      );
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

  const result = getActiveSchema().safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `  ${i.path.join(".") || "/"}: ${i.message}`).join("\n");
    throw new Error(`Invalid config in ${label}:\n${errors}`);
  }

  return result.data as PipelineConfig;
}
