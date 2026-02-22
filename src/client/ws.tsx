import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { LogLine, MessageOf, SystemStatus, WSClientMessage, WSServerMessage } from "../types.ts";

// --- Derived types from the message union ---

export type WSStepMessage = MessageOf<WSServerMessage, "step">;
export type WSRunStatusMessage = MessageOf<WSServerMessage, "run:status">;
export type WSGlobalEvent = MessageOf<WSServerMessage, "run:started"> | MessageOf<WSServerMessage, "run:completed">;

export interface SubscriptionHandlers {
  onLog?: (log: LogLine) => void;
  onStep?: (step: WSStepMessage) => void;
  onRunStatus?: (update: WSRunStatusMessage) => void;
}

type GlobalHandler = (event: WSGlobalEvent) => void;

// --- Contexts (split for performance: actions are stable, state changes on updates) ---

interface WSActions {
  subscribe: (topic: string) => void;
  unsubscribe: (topic: string) => void;
  addRunHandler: (topic: string, handlers: SubscriptionHandlers) => void;
  removeRunHandler: (topic: string) => void;
  addGlobalHandler: (handler: GlobalHandler) => () => void;
}

interface WSState {
  status: SystemStatus | null;
  connected: boolean;
}

const WSActionsContext = createContext<WSActions | null>(null);
const WSStateContext = createContext<WSState>({ status: null, connected: false });

function useWSActions(): WSActions {
  const ctx = useContext(WSActionsContext);
  if (!ctx) throw new Error("useWSActions requires WebSocketProvider");
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

  function sendMsg(ws: WebSocket, msg: WSClientMessage) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function connect() {
    if (unmountedRef.current) return;
    // Prevent duplicate connections from rapid reconnect cycles
    clearTimeout(reconnectTimerRef.current);
    wsRef.current?.close();

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
        dispatch(JSON.parse(e.data) as WSServerMessage);
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

  function dispatch(msg: WSServerMessage) {
    switch (msg.type) {
      case "status":
        setStatus(msg);
        break;

      case "run:started":
      case "run:completed":
        for (const handler of globalHandlersRef.current) {
          handler(msg);
        }
        break;

      case "log": {
        const handlers = runHandlersRef.current.get(`run:${msg.runId}`);
        handlers?.onLog?.(msg);
        break;
      }

      case "step": {
        const handlers = runHandlersRef.current.get(`run:${msg.runId}`);
        handlers?.onStep?.(msg);
        break;
      }

      case "run:status": {
        const handlers = runHandlersRef.current.get(`run:${msg.runId}`);
        handlers?.onRunStatus?.(msg);
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

  const subscribeTopic = useCallback((topic: string) => {
    activeTopicsRef.current.add(topic);
    const ws = wsRef.current;
    if (ws) sendMsg(ws, { type: "subscribe", topic });
  }, []);

  const unsubscribeTopic = useCallback((topic: string) => {
    activeTopicsRef.current.delete(topic);
    const ws = wsRef.current;
    if (ws) sendMsg(ws, { type: "unsubscribe", topic });
  }, []);

  const addRunHandler = useCallback((topic: string, handlers: SubscriptionHandlers) => {
    runHandlersRef.current.set(topic, handlers);
  }, []);

  const removeRunHandler = useCallback((topic: string) => {
    runHandlersRef.current.delete(topic);
  }, []);

  const addGlobalHandler = useCallback((handler: GlobalHandler) => {
    globalHandlersRef.current.add(handler);
    return () => {
      globalHandlersRef.current.delete(handler);
    };
  }, []);

  const actions = useMemo<WSActions>(
    () => ({ subscribe: subscribeTopic, unsubscribe: unsubscribeTopic, addRunHandler, removeRunHandler, addGlobalHandler }),
    [subscribeTopic, unsubscribeTopic, addRunHandler, removeRunHandler, addGlobalHandler],
  );

  const state = useMemo<WSState>(() => ({ status, connected }), [status, connected]);

  return (
    <WSActionsContext.Provider value={actions}>
      <WSStateContext.Provider value={state}>{children}</WSStateContext.Provider>
    </WSActionsContext.Provider>
  );
}

// --- Hooks ---

export function useStatus() {
  const { status } = useContext(WSStateContext);
  return { data: status };
}

export function useConnected() {
  const { connected } = useContext(WSStateContext);
  return connected;
}

export function useSubscription(topic: string | null, handlers: SubscriptionHandlers) {
  const ws = useWSActions();
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
  const ws = useWSActions();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return ws.addGlobalHandler((event) => handlerRef.current(event));
  }, [ws]);
}
