import { env } from "../../env.ts";
import { booleanOrTemplate, defineAction, expectBoolean, expectStringArray, stringArrayOrTemplate, z } from "../types.ts";

const schema = z
  .object({
    urls: stringArrayOrTemplate.optional(),
    purge_everything: booleanOrTemplate.optional(),
  })
  .strict();

export default defineAction({
  name: "cloudflare-purge",
  schema,
  handler: async (config, ctx) => {
    if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ZONE_ID) {
      throw new Error("Cloudflare purge requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID env vars");
    }

    const purge_everything = config.purge_everything != null ? expectBoolean(config.purge_everything, "purge_everything") : false;

    const body: Record<string, unknown> = {};
    if (purge_everything) {
      body.purge_everything = true;
      ctx.log("purging all cached content");
    } else if (config.urls != null) {
      const urls = expectStringArray(config.urls, "urls");
      if (urls.length === 0) {
        throw new Error("Cloudflare purge: urls array is empty");
      }
      body.files = urls;
      ctx.log("purging urls", { urlCount: urls.length, urls });
    } else {
      throw new Error("Cloudflare purge: must specify urls or purge_everything");
    }

    const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctx.signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Cloudflare purge failed: ${resp.status} ${text}`);
    }

    const result = (await resp.json()) as { success: boolean; errors?: { message: string }[] };
    if (!result.success) {
      throw new Error(result.errors?.map((e) => e.message).join(", ") ?? "cloudflare purge failed");
    }

    ctx.log("cache purge completed");
    return { output: { success: true } };
  },
});
