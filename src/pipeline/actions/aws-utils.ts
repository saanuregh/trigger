import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { ECSClient } from "@aws-sdk/client-ecs";
import { errorMessage } from "../../types.ts";
import type { ActionContext } from "../types.ts";

export function lazyClient<T>(factory: (region: string) => T): (region: string) => T {
  const cache = new Map<string, T>();
  return (region) => {
    let client = cache.get(region);
    if (!client) { client = factory(region); cache.set(region, client); }
    return client;
  };
}

export const getCwLogsClient = lazyClient((region) => new CloudWatchLogsClient({ region }));
export const getEcsClient = lazyClient((region) => new ECSClient({ region }));

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error("Aborted"));
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new Error("Aborted")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export type PollResult =
  | "continue"
  | { done: true; output?: Record<string, unknown> }
  | { error: string };

export async function pollUntil<T>(opts: {
  deadline: number;
  intervalMs: number;
  signal: AbortSignal;
  poll: () => Promise<T>;
  check: (result: T) => PollResult | Promise<PollResult>;
  onProgress?: (result: T) => void | Promise<void>;
  timeoutMessage: string;
}): Promise<{ output?: Record<string, unknown> }> {
  while (!opts.signal.aborted && Date.now() < opts.deadline) {
    await sleep(opts.intervalMs, opts.signal);

    const result = await opts.poll();
    const status = await opts.check(result);

    if (status === "continue") {
      await opts.onProgress?.(result);
      continue;
    }
    if ("error" in status) throw new Error(status.error);
    return { output: status.output };
  }

  if (opts.signal.aborted) throw new Error("Aborted");
  throw new Error(opts.timeoutMessage);
}

export async function streamLogs(
  groupName: string,
  streamName: string,
  nextToken: string | undefined,
  ctx: ActionContext,
): Promise<string | undefined> {
  try {
    const resp = await getCwLogsClient(ctx.region).send(
      new GetLogEventsCommand({
        logGroupName: groupName,
        logStreamName: streamName,
        startFromHead: true,
        nextToken,
      }),
    );

    for (const event of resp.events ?? []) {
      if (event.message) ctx.log(event.message.trimEnd());
    }

    return resp.nextForwardToken ?? nextToken;
  } catch (err) {
    const msg = errorMessage(err);
    ctx.warn("log streaming failed (will retry)", { error: msg, logGroup: groupName, logStream: streamName });
    return nextToken;
  }
}
