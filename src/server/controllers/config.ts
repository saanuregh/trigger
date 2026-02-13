import { z } from "zod";
import { authed } from "../../auth/access.ts";
import { loadAllConfigs } from "../../config/loader.ts";
import { pipelineConfigSchema } from "../../config/schema.ts";
import { logger } from "../../logger.ts";

const configJsonSchema = z.toJSONSchema(pipelineConfigSchema);

export const getConfigSchema = () => Response.json(configJsonSchema);

export const refreshConfig = authed(async (_req, session) => {
  if (!session.isSuperAdmin) {
    return Response.json({ error: "Forbidden: admin only" }, { status: 403 });
  }
  logger.info({ refreshedBy: session.email }, "config refresh requested");
  await loadAllConfigs(true);
  return Response.json({ ok: true });
});
