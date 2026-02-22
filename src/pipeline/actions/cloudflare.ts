import { env } from "../../env.ts";
import { booleanOrTemplate, defineAction, expectBoolean, expectStringArray, stringArrayOrTemplate, z } from "../types.ts";

const schema = z
  .object({
    urls: stringArrayOrTemplate.optional(),
    purge_everything: booleanOrTemplate.optional(),
  })
  .strict();

// Cloudflare API limits to 30 URLs per request
const PURGE_BATCH_SIZE = 30;

export default defineAction({
  name: "cloudflare-purge",
  schema,
  handler: async (config, ctx) => {
    if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ZONE_ID) {
      throw new Error("Cloudflare purge requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID env vars");
    }

    const purge_everything = config.purge_everything != null ? expectBoolean(config.purge_everything, "purge_everything") : false;

    async function purgeCache(purgeBody: Record<string, unknown>) {
      const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(purgeBody),
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
    }

    if (purge_everything) {
      ctx.log("purging all cached content");
      await purgeCache({ purge_everything: true });
    } else if (config.urls != null) {
      const urls = expectStringArray(config.urls, "urls");
      if (urls.length === 0) {
        throw new Error("Cloudflare purge: urls array is empty");
      }
      ctx.log("purging urls", { urlCount: urls.length, urls });

      for (let i = 0; i < urls.length; i += PURGE_BATCH_SIZE) {
        const batch = urls.slice(i, i + PURGE_BATCH_SIZE);
        await purgeCache({ files: batch });
        if (urls.length > PURGE_BATCH_SIZE) ctx.log("batch purged", { batch: Math.floor(i / PURGE_BATCH_SIZE) + 1, urls: batch.length });
      }
    } else {
      throw new Error("Cloudflare purge: must specify urls or purge_everything");
    }

    ctx.log("cache purge completed");
    return { output: { success: true } };
  },
});
