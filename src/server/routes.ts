import appPage from "../../public/index.html";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import * as auth from "./controllers/auth.ts";
import * as config from "./controllers/config.ts";
import * as pipelines from "./controllers/pipelines.ts";
import * as runs from "./controllers/runs.ts";

export const routes = {
  "/*": appPage,

  "/health": () => Response.json({ status: "ok" }),

  // Auth
  "/api/auth/info": auth.info,
  "/auth/login": auth.login,
  "/auth/callback": auth.callback,
  "/api/me": auth.me,
  "/api/auth/logout": { POST: auth.logout },

  // Pipelines
  "/api/configs": pipelines.listConfigs,
  "/api/pipelines/:ns/:id": pipelines.getPipeline,
  "/api/pipelines/:ns/:id/config": pipelines.getPipelineConfig,
  "/api/pipelines/:ns/:id/run": { POST: pipelines.triggerPipeline },

  // Runs
  "/api/runs": runs.listRuns,
  "/api/runs/:runId": runs.getRun,
  "/api/runs/:runId/logs": runs.getRunLogs,
  "/api/runs/:runId/cancel": { POST: runs.cancelRun },

  // Config management
  "/api/config/schema": config.getConfigSchema,
  "/api/config/refresh": { POST: config.refreshConfig },

  // SSE
  "/sse/runs/:runId": runs.sseRun,
};

export function fetch(req: Request) {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/sse/") || url.pathname.startsWith("/auth/")) {
    logger.warn({ method: req.method, path: url.pathname }, "unmatched API route");
  }
  return new Response("Not found", { status: 404 });
}

export function error(err: Error) {
  logger.error({ err }, "server error");
  return Response.json(
    {
      error: err.message,
      ...(env.development ? { stack: err.stack } : {}),
    },
    { status: 500 },
  );
}
