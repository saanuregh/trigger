import { env } from "../../env.ts";
import type { CloudflarePurgeActionConfig } from "../../config/types.ts";
import type { ActionContext } from "../types.ts";

export async function executeCloudflare(config: CloudflarePurgeActionConfig, ctx: ActionContext) {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ZONE_ID) {
    throw new Error("Cloudflare purge requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID env vars");
  }

  const body: Record<string, unknown> = {};
  if (config.purge_everything) {
    body.purge_everything = true;
    ctx.log("purging all cached content");
  } else if (config.urls?.length) {
    body.files = config.urls;
    ctx.log("purging urls", { urlCount: config.urls.length, urls: config.urls });
  } else {
    throw new Error("Cloudflare purge: must specify urls or purge_everything");
  }

  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctx.signal,
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Cloudflare purge failed: ${resp.status} ${text}`);
  }

  const result = await resp.json() as { success: boolean; errors?: { message: string }[] };
  if (!result.success) {
    throw new Error(result.errors?.map(e => e.message).join(", ") ?? "cloudflare purge failed");
  }

  ctx.log("cache purge completed");
  return { output: { success: true } };
}
