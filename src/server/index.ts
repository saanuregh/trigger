import { readdirSync, rmSync, statSync } from "node:fs";
import { fetchOIDCConfig } from "../auth/oidc.ts";
import { loadAllConfigs, rebuildConfigSchema } from "../config/loader.ts";
import { closeDb, getDb } from "../db/index.ts";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import { loadCustomActions } from "../pipeline/action-loader.ts";
import { initBuiltinActions, recoverStaleRuns, shutdownAll } from "../pipeline/executor.ts";
import { startScheduler, stopScheduler } from "../scheduler.ts";
import { errorMessage } from "../types.ts";
import { error, fetch, routes } from "./routes.ts";
import { initWSGlobalSubscription, wsHandlers } from "./ws.ts";

let _server: ReturnType<typeof Bun.serve> | null = null;

function cleanupOldLogs() {
  const retentionMs = env.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;
  const logsDir = `${env.DATA_DIR}/logs`;
  let cleaned = 0;
  try {
    for (const entry of readdirSync(logsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const dirPath = `${logsDir}/${entry.name}`;
        if (statSync(dirPath).mtimeMs < cutoff) {
          rmSync(dirPath, { recursive: true });
          cleaned++;
        }
      } catch {
        /* individual dir cleanup failure is non-fatal */
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn({ error: errorMessage(err) }, "log cleanup scan failed");
    }
  }
  if (cleaned > 0) logger.info({ cleaned, retentionDays: env.LOG_RETENTION_DAYS }, "old logs cleaned up");
}

export function getServer() {
  return _server!;
}

export async function startServer(): Promise<void> {
  getDb();
  recoverStaleRuns();

  initBuiltinActions();
  await loadCustomActions(env.ACTIONS_DIR);
  rebuildConfigSchema();

  loadAllConfigs()
    .then((configs) => startScheduler(configs))
    .catch((err) => {
      logger.error({ error: errorMessage(err) }, "initial config load failed — pipelines may be unavailable until next refresh");
    });

  if (env.authEnabled) {
    if (!env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) {
      throw new Error("OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required when auth is enabled (OIDC_ISSUER is set)");
    }
    try {
      await fetchOIDCConfig();
    } catch (err) {
      logger.error({ error: errorMessage(err) }, "OIDC discovery failed — auth will not work until server restart");
    }
  }

  const server = Bun.serve({
    port: env.PORT,
    development: env.development,
    routes,
    fetch,
    error,
    websocket: wsHandlers,
  });

  _server = server;
  initWSGlobalSubscription();

  logger.info({ env: env.NODE_ENV, port: server.port, dataDir: env.DATA_DIR }, "server started");

  cleanupOldLogs();
  const cleanupInterval = setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

  let shuttingDown = false;

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("server shutting down");

    stopScheduler();
    clearInterval(cleanupInterval);
    server.stop();
    await shutdownAll();

    closeDb();

    logger.info("shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
