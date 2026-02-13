import { env } from "../env.ts";
import { getDb, closeDb } from "../db/index.ts";
import { loadAllConfigs } from "../config/loader.ts";
import { shutdownAll, recoverStaleRuns } from "../pipeline/executor.ts";
import { logger } from "../logger.ts";
import { routes, fetch, error } from "./routes.ts";
import { fetchOIDCConfig } from "../auth/oidc.ts";

export function startServer() {
  getDb();
  recoverStaleRuns();
  loadAllConfigs();

  if (env.authEnabled) {
    fetchOIDCConfig().catch((err) => {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, "OIDC discovery failed — auth will not work");
    });
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
