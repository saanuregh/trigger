import { useCallback, useEffect, useRef, useState } from "react";
import type { NamespaceConfigSummary } from "../types.ts";

// --- Fetcher ---

export async function fetcher(url: string) {
  const r = await fetch(url);
  if (r.status === 401) {
    window.location.href = `/login?return=${encodeURIComponent(window.location.pathname)}&error=session_expired`;
    throw new Error("Unauthorized");
  }
  if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`);
  return r.json();
}

// --- Cache & dedup ---

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

// --- useFetch hook ---

interface UseFetchOptions {
  refreshInterval?: number;
}

export function useFetch<T>(url: string | null, options?: UseFetchOptions) {
  const [data, setData] = useState<T | undefined>(url ? (cache.get(url) as T | undefined) : undefined);
  const [error, setError] = useState<Error | undefined>();
  const [isLoading, setIsLoading] = useState(!cache.has(url ?? ""));
  const urlRef = useRef(url);
  urlRef.current = url;

  const doFetch = useCallback(async (): Promise<T | undefined> => {
    const key = urlRef.current;
    if (!key) return undefined;
    let promise = inflight.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = fetcher(key) as Promise<T>;
      inflight.set(key, promise);
      promise.finally(() => inflight.delete(key));
    }
    try {
      const result = await promise;
      cache.set(key, result);
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
    setIsLoading(!cache.has(url));
    if (cache.has(url)) setData(cache.get(url) as T);
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
      if (updater !== undefined) {
        const next = typeof updater === "function" ? (updater as (prev: T | undefined) => T | undefined)(data) : updater;
        if (next !== undefined) {
          setData(next);
          if (urlRef.current) cache.set(urlRef.current, next);
        }
        return next;
      }
      return doFetch();
    },
    [data, doFetch],
  );

  return { data, error, isLoading, mutate };
}

// --- App-specific hooks ---

export interface User {
  email: string;
  name: string;
  groups: string[];
  isSuperAdmin: boolean;
}

export function useConfigs() {
  return useFetch<NamespaceConfigSummary[]>("/api/configs");
}

export function useNsDisplayName(ns: string): string {
  const { data } = useConfigs();
  return data?.find((c) => c.namespace === ns)?.display_name ?? ns;
}

export function useUser() {
  return useFetch<User>("/api/me");
}
