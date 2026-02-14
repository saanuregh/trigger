import { fetchOIDCConfig } from "../auth/oidc.ts";
import { loadAllConfigs, rebuildConfigSchema } from "../config/loader.ts";
import { closeDb, getDb } from "../db/index.ts";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import { loadCustomActions } from "../pipeline/action-loader.ts";
import { initBuiltinActions, recoverStaleRuns, shutdownAll } from "../pipeline/executor.ts";
import { errorMessage } from "../types.ts";
import { error, fetch, routes } from "./routes.ts";

export async function startServer(): Promise<void> {
  getDb();
  recoverStaleRuns();

  initBuiltinActions();
  await loadCustomActions(env.ACTIONS_DIR);
  rebuildConfigSchema();

  loadAllConfigs().catch((err) => {
    logger.error({ error: errorMessage(err) }, "initial config load failed — pipelines may be unavailable until next refresh");
  });

  if (env.authEnabled) {
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
  });

  logger.info({ env: env.NODE_ENV, port: server.port, dataDir: env.DATA_DIR }, "server started");

  let shuttingDown = false;

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("server shutting down");

    shutdownAll();
    server.stop();

    await new Promise((resolve) => setTimeout(resolve, 2_000));

    closeDb();

    logger.info("shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
