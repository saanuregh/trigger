import { canAccessNamespace, canAccessPipeline } from "../../auth/access.ts";
import type { AuthSession } from "../../auth/session.ts";
import { getCachedConfigs, loadAllConfigs } from "../../config/loader.ts";
import type { NamespaceConfig } from "../../config/types.ts";
import type { NamespaceConfigSummary, StepDefSummary } from "../../types.ts";

export type RouteRequest = Request & { params: Record<string, string> };

export async function getConfigs(): Promise<NamespaceConfig[]> {
  return getCachedConfigs() ?? (await loadAllConfigs());
}

export function toStepSummary(s: { id: string; name: string; action: string }): StepDefSummary {
  return { id: s.id, name: s.name, action: s.action };
}

export function toClientConfigs(configs: NamespaceConfig[]): NamespaceConfigSummary[] {
  return configs.map((ns) => ({
    namespace: ns.namespace,
    display_name: ns.display_name,
    pipelines: ns.pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      confirm: p.confirm,
      params: p.params,
      steps: p.steps.map(toStepSummary),
    })),
    ...(ns._error && { error: ns._error }),
  }));
}

export function findNsConfig(configs: NamespaceConfig[], ns: string): NamespaceConfig | undefined {
  return configs.find((c) => c.namespace === ns);
}

export async function checkNamespaceAccess(session: AuthSession, namespace: string): Promise<Response | null> {
  const configs = await getConfigs();
  const nsConfig = findNsConfig(configs, namespace);
  if (nsConfig && !canAccessNamespace(session, nsConfig)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export function checkPipelineAccess(
  session: AuthSession,
  nsConfig: NamespaceConfig | undefined,
  pipeline: NamespaceConfig["pipelines"][number] | undefined,
): Response | null {
  if (!nsConfig) return Response.json({ error: "Namespace not found" }, { status: 404 });
  if (!pipeline) return Response.json({ error: "Pipeline not found" }, { status: 404 });
  if (!canAccessPipeline(session, nsConfig, pipeline)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export const MAX_LOG_LINES = 50_000;

export const OAUTH_STATE_COOKIE = "trigger_oauth_state";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

export function sseFormat(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function terminalSSEResponse(status: string): Response {
  return new Response(sseFormat("run", { status }), { headers: SSE_HEADERS });
}
