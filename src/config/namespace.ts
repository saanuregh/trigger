import { env } from "../env.ts";

export interface NamespaceSource {
  namespace: string;
  config: string; // GitHub file URL or local path
}

export function resolveNamespaces(): NamespaceSource[] {
  return env.TRIGGER_NAMESPACES.map((ns) => ({
    namespace: ns,
    config: env.namespaceConfig(ns),
  }));
}
