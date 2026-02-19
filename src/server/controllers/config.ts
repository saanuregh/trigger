import { getJSONSchema } from "../../config/loader.ts";

export const getConfigSchema = () => Response.json(getJSONSchema());
