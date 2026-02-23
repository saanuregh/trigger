import type { ServerWebSocket } from "bun";
import type { AuthSession } from "../auth/session.ts";
import * as db from "../db/queries.ts";
import { env } from "../env.ts";
import { subscribe } from "../events.ts";
import { logger } from "../logger.ts";
import { getActiveRunSummary } from "../pipeline/executor.ts";
import { type ActiveRunInfo, errorMessage, type SystemStatus, TERMINAL_STATUSES, type WSServerMessage } from "../types.ts";
import { checkNamespaceAccess } from "./controllers/helpers.ts";
import { wsClientMessageSchema } from "./validation.ts";

export interface WSData {
  session: AuthSession | null;
  subscriptions: Map<string, () => void>;
  closed?: boolean;
}

type WS = ServerWebSocket<WSData>;

const MAX_WS_CONNECTIONS = 1000;
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

  if (env.authEnabled) {
    if (!ws.data.session) {
      send(ws, { type: "error", message: "Unauthorized" });
      return;
    }
    const denied = await checkNamespaceAccess(ws.data.session, run.namespace);
    if (denied) {
      send(ws, { type: "error", message: "Forbidden" });
      return;
    }
  }

  // Guard: socket may have closed during the async access check above
  if (ws.data.closed) return;

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
    if (sockets.size >= MAX_WS_CONNECTIONS) {
      logger.warn({ current: sockets.size }, "ws connection limit reached, rejecting");
      ws.close(1013, "Too many connections");
      return;
    }
    sockets.add(ws);
    send(ws, { type: "status", ...buildStatus() });
  },

  message(ws: WS, raw: string | Buffer) {
    try {
      const parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString());
      const result = wsClientMessageSchema.safeParse(parsed);

      if (!result.success) {
        logger.warn(
          {
            error: "Invalid WebSocket message format",
            issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
          "ws message validation failed",
        );
        send(ws, { type: "error", message: "Invalid message format" });
        return;
      }

      if (result.data.type === "subscribe") {
        handleSubscribe(ws, result.data.topic).catch((err) => {
          logger.warn({ error: errorMessage(err) }, "ws subscribe failed");
          send(ws, { type: "error", message: "Subscribe failed" });
        });
      } else if (result.data.type === "unsubscribe") {
        handleUnsubscribe(ws, result.data.topic);
      }
    } catch (err) {
      logger.warn({ error: errorMessage(err) }, "ws message parse failed");
      send(ws, { type: "error", message: "Failed to parse message" });
    }
  },

  close(ws: WS) {
    ws.data.closed = true;
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
