import useSWR from "swr";
import type { NamespaceConfigSummary } from "../types.ts";

export interface User {
  email: string;
  name: string;
  groups: string[];
  isSuperAdmin: boolean;
}

export function fetcher(url: string) {
  return fetch(url).then((r) => {
    if (r.status === 401) {
      window.location.href = `/login?return=${encodeURIComponent(window.location.pathname)}&error=session_expired`;
      throw new Error("Unauthorized");
    }
    if (!r.ok) throw new Error(r.statusText || `HTTP ${r.status}`);
    return r.json();
  });
}

export function useConfigs() {
  return useSWR<NamespaceConfigSummary[]>("/api/configs");
}

export function useNsDisplayName(ns: string): string {
  const { data } = useConfigs();
  return data?.find((c) => c.namespace === ns)?.display_name ?? ns;
}

export function useUser() {
  return useSWR<User>("/api/me", {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
}
