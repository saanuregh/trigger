import type { PipelineDef } from "../config/schema.ts";
import type { NamespaceConfig } from "../config/types.ts";
import { env } from "../env.ts";
import { type AuthSession, getSession } from "./session.ts";

type AuthedHandler = (req: Request & { params: Record<string, string> }, session: AuthSession) => Response | Promise<Response>;

/**
 * Higher-order function wrapping route handlers with authentication.
 * When auth is disabled (no OIDC_ISSUER), passes through with a stub session.
 * When enabled, verifies the session cookie and returns 401 if invalid.
 */
export function authed(handler: AuthedHandler) {
  return async (req: Request & { params: Record<string, string> }) => {
    if (!env.authEnabled) {
      const stub: AuthSession = { email: "", name: "", groups: [], isSuperAdmin: true };
      return handler(req, stub);
    }

    const session = await getSession(req);
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    return handler(req, session);
  };
}

interface AccessConfig {
  groups?: string[];
}

function getNamespaceAccess(nsConfig: NamespaceConfig): AccessConfig | undefined {
  return (nsConfig as NamespaceConfig & { access?: AccessConfig }).access;
}

function getPipelineAccess(pipeline: PipelineDef): AccessConfig | undefined {
  return (pipeline as PipelineDef & { access?: AccessConfig }).access;
}

function hasGroupOverlap(userGroups: string[], allowedGroups: string[]): boolean {
  return userGroups.some((g) => allowedGroups.includes(g));
}

export function canAccessNamespace(session: AuthSession, nsConfig: NamespaceConfig): boolean {
  if (session.isSuperAdmin) return true;

  const access = getNamespaceAccess(nsConfig);
  if (!access?.groups || access.groups.length === 0) return true;

  return hasGroupOverlap(session.groups, access.groups);
}

export function canAccessPipeline(session: AuthSession, nsConfig: NamespaceConfig, pipeline: PipelineDef): boolean {
  if (session.isSuperAdmin) return true;

  // Pipeline-level access overrides namespace-level
  const pipelineAccess = getPipelineAccess(pipeline);
  if (pipelineAccess?.groups && pipelineAccess.groups.length > 0) {
    return hasGroupOverlap(session.groups, pipelineAccess.groups);
  }

  // Fall back to namespace-level
  return canAccessNamespace(session, nsConfig);
}

export function filterAccessibleConfigs(configs: NamespaceConfig[], session: AuthSession): NamespaceConfig[] {
  if (session.isSuperAdmin) return configs;

  return configs
    .filter((ns) => canAccessNamespace(session, ns))
    .map((ns) => {
      const accessiblePipelines = ns.pipelines.filter((p) => canAccessPipeline(session, ns, p));
      return { ...ns, pipelines: accessiblePipelines };
    })
    .filter((ns) => ns.pipelines.length > 0 || !getNamespaceAccess(ns)?.groups);
}
