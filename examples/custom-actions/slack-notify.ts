// import { defineAction, z } from "trigger-sdk";
import { defineAction, z } from "../../packages/trigger-sdk/index.ts";

const schema = z
  .object({
    webhook_url: z.string().url(),
    message: z.string(),
    channel: z.string().optional(),
  })
  .strict();

export default defineAction({
  name: "slack-notify",
  schema,
  handler: async (config, ctx) => {
    ctx.log("sending Slack notification", { channel: config.channel });

    const body = {
      text: config.message,
      ...(config.channel ? { channel: config.channel } : {}),
    };

    const res = await fetch(config.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctx.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Slack webhook failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
    }

    ctx.log("notification sent");
    return { output: { ok: true } };
  },
});
