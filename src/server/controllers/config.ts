import { authed } from "../../auth/access.ts";
import { getJSONSchema } from "../../config/loader.ts";

export const getConfigSchema = authed(() => Response.json(getJSONSchema()));
