import type { ServerWebSocket } from "bun";
import type { AuthSession } from "../auth/session.ts";
import * as db from "../db/queries.ts";
import { env } from "../env.ts";
import { subscribe } from "../events.ts";
import { logger } from "../logger.ts";
import { getActiveRunSummary } from "../pipeline/executor.ts";
import { type ActiveRunInfo, errorMessage, type SystemStatus, TERMINAL_STATUSES, type WSServerMessage } from "../types.ts";
import { checkNamespaceAccess } from "./controllers/helpers.ts";

export interface WSData {
  session: AuthSession | null;
  subscriptions: Map<string, () => void>;
}

type WS = ServerWebSocket<WSData>;

const sockets = new Set<WS>();

function buildStatus(): SystemStatus {
  const { total, byPipeline } = getActiveRunSummary();
  const pipelines: ActiveRunInfo[] = Object.entries(byPipeline).map(([key, runIds]) => {
    const [namespace, pipelineId] = key.split(":");
    return { namespace: namespace!, pipelineId: pipelineId!, runIds };
  });
  return { activeRuns: total, maxConcurrentRuns: env.MAX_CONCURRENT_RUNS, pipelines };
}

function send(ws: WS, msg: WSServerMessage) {
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    logger.warn({ error: errorMessage(err) }, "ws send failed");
  }
}

export function broadcast(msg: WSServerMessage) {
  const payload = JSON.stringify(msg);
  for (const ws of sockets) {
    try {
      ws.send(payload);
    } catch {
      // socket will be cleaned up on close
    }
  }
}

function broadcastStatus() {
  broadcast({ type: "status", ...buildStatus() });
}

async function handleSubscribe(ws: WS, topic: string) {
  if (!topic.startsWith("run:")) {
    send(ws, { type: "error", message: `Unknown topic: ${topic}` });
    return;
  }

  const runId = topic.slice(4);

  if (ws.data.subscriptions.has(topic)) return;

  const run = db.getRun(runId);
  if (!run) {
    send(ws, { type: "error", message: "Run not found" });
    return;
  }

  if (env.authEnabled && ws.data.session) {
    const denied = await checkNamespaceAccess(ws.data.session, run.namespace);
    if (denied) {
      send(ws, { type: "error", message: "Forbidden" });
      return;
    }
  }

  const unsubscribe = subscribe(runId, (message) => {
    if (message.type === "log") {
      send(ws, message);
    } else if (message.type === "step:status") {
      send(ws, {
        type: "step",
        runId: message.runId,
        stepId: message.stepId,
        stepName: message.stepName,
        action: message.action,
        status: message.status,
      });
    } else if (message.type === "run:status") {
      send(ws, message);
    }
  });

  ws.data.subscriptions.set(topic, unsubscribe);

  // Race condition guard: run may have finished between lookup and subscribe
  const freshRun = db.getRun(runId);
  if (freshRun && TERMINAL_STATUSES.has(freshRun.status)) {
    send(ws, { type: "run:status", runId, status: freshRun.status });
  }
}

function handleUnsubscribe(ws: WS, topic: string) {
  const unsub = ws.data.subscriptions.get(topic);
  if (unsub) {
    unsub();
    ws.data.subscriptions.delete(topic);
  }
}

export const wsHandlers = {
  open(ws: WS) {
    sockets.add(ws);
    send(ws, { type: "status", ...buildStatus() });
  },

  message(ws: WS, raw: string | Buffer) {
    try {
      const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());

      if (msg.type === "subscribe" && typeof msg.topic === "string") {
        handleSubscribe(ws, msg.topic);
      } else if (msg.type === "unsubscribe" && typeof msg.topic === "string") {
        handleUnsubscribe(ws, msg.topic);
      }
    } catch (err) {
      logger.warn({ error: errorMessage(err) }, "ws message parse failed");
    }
  },

  close(ws: WS) {
    for (const unsub of ws.data.subscriptions.values()) unsub();
    ws.data.subscriptions.clear();
    sockets.delete(ws);
  },
};

export function initWSGlobalSubscription() {
  subscribe("global", (message) => {
    if (message.type === "run:started" || message.type === "run:completed") {
      broadcast(message);
      broadcastStatus();
    }
  });
}
