import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { LogLine, SystemStatus } from "../types.ts";

// --- Types ---

interface StepUpdate {
  stepId: string;
  stepName: string;
  action: string;
  status: string;
}

interface RunStatusUpdate {
  runId: string;
  status: string;
}

interface GlobalEvent {
  type: "run:started" | "run:completed";
  runId: string;
  namespace: string;
  pipelineId: string;
  status?: string;
}

interface SubscriptionHandlers {
  onLog?: (log: LogLine) => void;
  onStep?: (step: StepUpdate) => void;
  onRunStatus?: (update: RunStatusUpdate) => void;
}

type GlobalHandler = (event: GlobalEvent) => void;

// --- Context ---

interface WSContextValue {
  status: SystemStatus | null;
  connected: boolean;
  subscribe: (topic: string) => void;
  unsubscribe: (topic: string) => void;
  addRunHandler: (topic: string, handlers: SubscriptionHandlers) => void;
  removeRunHandler: (topic: string) => void;
  addGlobalHandler: (handler: GlobalHandler) => () => void;
}

const WSContext = createContext<WSContextValue | null>(null);

function useWS(): WSContextValue {
  const ctx = useContext(WSContext);
  if (!ctx) throw new Error("useWS requires WebSocketProvider");
  return ctx;
}

// --- Provider ---

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const runHandlersRef = useRef(new Map<string, SubscriptionHandlers>());
  const globalHandlersRef = useRef(new Set<GlobalHandler>());
  const activeTopicsRef = useRef(new Set<string>());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const backoffRef = useRef(1000);
  const unmountedRef = useRef(false);

  function sendMsg(ws: WebSocket, msg: object) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function connect() {
    if (unmountedRef.current) return;

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      backoffRef.current = 1000;
      // Re-subscribe to all active topics on reconnect
      for (const topic of activeTopicsRef.current) {
        sendMsg(ws, { type: "subscribe", topic });
      }
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        dispatch(msg);
      } catch {
        console.warn("WS: failed to parse message", e.data);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (!unmountedRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          backoffRef.current = Math.min(backoffRef.current * 2, 30000);
          connect();
        }, backoffRef.current);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
    };
  }

  function dispatch(msg: Record<string, unknown>) {
    switch (msg.type) {
      case "status":
        setStatus({
          activeRuns: msg.activeRuns as number,
          maxConcurrentRuns: msg.maxConcurrentRuns as number,
          pipelines: msg.pipelines as SystemStatus["pipelines"],
        });
        break;

      case "run:started":
      case "run:completed":
        for (const handler of globalHandlersRef.current) {
          handler(msg as unknown as GlobalEvent);
        }
        break;

      case "log": {
        // Find which run subscription this belongs to by checking runId
        const runId = msg.runId as string;
        const handlers = runHandlersRef.current.get(`run:${runId}`);
        handlers?.onLog?.(msg as unknown as LogLine);
        break;
      }

      case "step": {
        const runId = msg.runId as string | undefined;
        // step messages come from per-run subscriptions; find handler by iterating
        for (const [topic, handlers] of runHandlersRef.current) {
          if (runId && topic === `run:${runId}`) {
            handlers.onStep?.(msg as unknown as StepUpdate);
            break;
          }
        }
        break;
      }

      case "run:status": {
        const runId = msg.runId as string;
        const handlers = runHandlersRef.current.get(`run:${runId}`);
        handlers?.onRunStatus?.(msg as unknown as RunStatusUpdate);
        break;
      }

      case "error":
        console.warn("WS server error:", msg.message);
        break;
    }
  }

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  const subscribeTopic = (topic: string) => {
    activeTopicsRef.current.add(topic);
    const ws = wsRef.current;
    if (ws) sendMsg(ws, { type: "subscribe", topic });
  };

  const unsubscribeTopic = (topic: string) => {
    activeTopicsRef.current.delete(topic);
    const ws = wsRef.current;
    if (ws) sendMsg(ws, { type: "unsubscribe", topic });
  };

  const addRunHandler = (topic: string, handlers: SubscriptionHandlers) => {
    runHandlersRef.current.set(topic, handlers);
  };

  const removeRunHandler = (topic: string) => {
    runHandlersRef.current.delete(topic);
  };

  const addGlobalHandler = (handler: GlobalHandler) => {
    globalHandlersRef.current.add(handler);
    return () => {
      globalHandlersRef.current.delete(handler);
    };
  };

  return (
    <WSContext.Provider
      value={{
        status,
        connected,
        subscribe: subscribeTopic,
        unsubscribe: unsubscribeTopic,
        addRunHandler,
        removeRunHandler,
        addGlobalHandler,
      }}
    >
      {children}
    </WSContext.Provider>
  );
}

// --- Hooks ---

export function useStatus() {
  const { status } = useWS();
  return { data: status };
}

export function useConnected() {
  const { connected } = useWS();
  return connected;
}

export function useSubscription(topic: string | null, handlers: SubscriptionHandlers) {
  const ws = useWS();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!topic) return;

    // Register handler proxy that always calls latest handlers
    const proxy: SubscriptionHandlers = {
      onLog: (log) => handlersRef.current.onLog?.(log),
      onStep: (step) => handlersRef.current.onStep?.(step),
      onRunStatus: (update) => handlersRef.current.onRunStatus?.(update),
    };

    ws.addRunHandler(topic, proxy);
    ws.subscribe(topic);

    return () => {
      ws.unsubscribe(topic);
      ws.removeRunHandler(topic);
    };
  }, [topic, ws]);
}

export function useGlobalEvents(handler: GlobalHandler) {
  const ws = useWS();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return ws.addGlobalHandler((event) => handlerRef.current(event));
  }, [ws]);
}
