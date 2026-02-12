import { errorMessage } from "./types.ts";
import { logger } from "./logger.ts";

type Listener = (message: Record<string, unknown>) => void;

const MAX_LISTENERS_PER_TOPIC = 100;

const topicListeners = new Map<string, Set<Listener>>();
const globalListeners = new Set<Listener>();

export function publish(topic: string, message: Record<string, unknown>) {
  const listeners = topic === "global"
    ? globalListeners
    : topicListeners.get(topic);

  if (!listeners) return;

  for (const fn of listeners) {
    try {
      fn(message);
    } catch (err) {
      logger.error({ topic, messageType: message.type, error: errorMessage(err) }, "event listener threw");
    }
  }
}

export function subscribe(topic: string, listener: Listener): () => void {
  let set: Set<Listener>;

  if (topic === "global") {
    set = globalListeners;
  } else {
    set = topicListeners.get(topic) ?? new Set();
    topicListeners.set(topic, set);
  }

  if (set.size >= MAX_LISTENERS_PER_TOPIC) {
    logger.warn({ topic, limit: MAX_LISTENERS_PER_TOPIC }, "listener limit reached, rejecting subscriber");
    return () => {};
  }

  set.add(listener);
  return () => {
    set.delete(listener);
    if (topic !== "global" && set.size === 0) topicListeners.delete(topic);
  };
}
