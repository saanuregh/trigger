import { authed } from "../../auth/access.ts";
import { getJSONSchema, loadAllConfigs } from "../../config/loader.ts";
import { logger } from "../../logger.ts";

export const getConfigSchema = () => Response.json(getJSONSchema());

export const refreshConfig = authed(async (_req, session) => {
  if (!session.isSuperAdmin) {
    return Response.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  logger.info({ refreshedBy: session.email }, "config refresh requested");
  await loadAllConfigs(true);
  return Response.json({ ok: true });
});
