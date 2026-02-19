import { useCallback, useEffect, useRef, useState } from "react";
import type { NamespaceConfigSummary, UserResponse } from "../types.ts";

// --- Fetcher ---

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export async function fetcher<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (r.status === 401) {
    window.location.href = `/login?return=${encodeURIComponent(window.location.pathname)}&error=session_expired`;
    throw new FetchError("Unauthorized", 401);
  }
  if (!r.ok) throw new FetchError(r.statusText || `HTTP ${r.status}`, r.status);
  return r.json() as Promise<T>;
}

// --- Cache & dedup ---

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, { data: unknown; ts: number }>();
const inflight = new Map<string, Promise<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

function cacheSet(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() });
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL) cache.delete(k);
    }
  }
}

function cacheHas(key: string): boolean {
  return cacheGet(key) !== undefined;
}

// --- useFetch hook ---

interface UseFetchOptions {
  refreshInterval?: number;
}

export function useFetch<T>(url: string | null, options?: UseFetchOptions) {
  const [data, setData] = useState<T | undefined>(url ? cacheGet<T>(url) : undefined);
  const [error, setError] = useState<Error | undefined>();
  const [isLoading, setIsLoading] = useState(!cacheHas(url ?? ""));
  const urlRef = useRef(url);
  urlRef.current = url;

  const doFetch = useCallback(async (): Promise<T | undefined> => {
    const key = urlRef.current;
    if (!key) return undefined;
    let promise = inflight.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = fetcher<T>(key);
      inflight.set(key, promise);
      promise.finally(() => inflight.delete(key));
    }
    try {
      const result = await promise;
      cacheSet(key, result);
      if (urlRef.current === key) {
        setData(result);
        setError(undefined);
      }
      return result;
    } catch (err) {
      if (urlRef.current === key) setError(err instanceof Error ? err : new Error(String(err)));
      return undefined;
    } finally {
      if (urlRef.current === key) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!url) return;
    setIsLoading(!cacheHas(url));
    if (cacheHas(url)) setData(cacheGet<T>(url));
    doFetch();
  }, [url, doFetch]);

  useEffect(() => {
    const interval = options?.refreshInterval;
    if (!interval || !url) return;
    const id = setInterval(doFetch, interval);
    return () => clearInterval(id);
  }, [url, options?.refreshInterval, doFetch]);

  const mutate = useCallback(
    async (updater?: T | ((prev: T | undefined) => T | undefined)): Promise<T | undefined> => {
      if (updater === undefined) return doFetch();
      if (typeof updater === "function") {
        const fn = updater as (prev: T | undefined) => T | undefined;
        let next: T | undefined;
        setData((prev) => {
          next = fn(prev);
          if (next !== undefined && urlRef.current) cacheSet(urlRef.current, next);
          return next ?? prev;
        });
        return next;
      }
      setData(updater);
      if (urlRef.current) cacheSet(urlRef.current, updater);
      return updater;
    },
    [doFetch],
  );

  return { data, error, isLoading, mutate };
}

// --- App-specific hooks ---

export function useConfigs() {
  return useFetch<NamespaceConfigSummary[]>("/api/configs");
}

export function useUser() {
  return useFetch<UserResponse>("/api/me");
}
