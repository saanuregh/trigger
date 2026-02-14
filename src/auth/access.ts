import type { NamespaceConfig, PipelineDef } from "../config/types.ts";
import { env } from "../env.ts";
import { type AuthSession, getSession } from "./session.ts";

type AuthedHandler = (req: Request & { params: Record<string, string> }, session: AuthSession) => Response | Promise<Response>;

const STUB_SESSION = Object.freeze({ email: "", name: "", groups: Object.freeze([] as string[]), isSuperAdmin: true }) as AuthSession;

export function authed(handler: AuthedHandler) {
  return async (req: Request & { params: Record<string, string> }) => {
    if (!env.authEnabled) return handler(req, STUB_SESSION);

    const session = await getSession(req);
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

    return handler(req, session);
  };
}

function hasGroupOverlap(userGroups: string[], allowedGroups: string[]): boolean {
  return userGroups.some((g) => allowedGroups.includes(g));
}

export function canAccessNamespace(session: AuthSession, nsConfig: NamespaceConfig): boolean {
  if (session.isSuperAdmin) return true;

  const groups = nsConfig.access?.groups;
  if (!groups || groups.length === 0) return true;

  return hasGroupOverlap(session.groups, groups);
}

export function canAccessPipeline(session: AuthSession, nsConfig: NamespaceConfig, pipeline: PipelineDef): boolean {
  if (session.isSuperAdmin) return true;

  // Pipeline-level access overrides namespace-level
  const groups = pipeline.access?.groups;
  if (groups && groups.length > 0) {
    return hasGroupOverlap(session.groups, groups);
  }

  return canAccessNamespace(session, nsConfig);
}

export function filterAccessibleConfigs(configs: NamespaceConfig[], session: AuthSession): NamespaceConfig[] {
  if (session.isSuperAdmin) return configs;

  return configs
    .filter((ns) => canAccessNamespace(session, ns))
    .map((ns) => ({
      ...ns,
      pipelines: ns.pipelines.filter((p) => canAccessPipeline(session, ns, p)),
    }))
    .filter((ns) => ns.pipelines.length > 0 || !ns.access?.groups);
}
