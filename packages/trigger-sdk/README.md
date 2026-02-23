# @saanuregh/trigger-sdk

SDK for writing custom [Trigger](https://github.com/saanuregh/trigger) pipeline actions.

## Install

```bash
bun add @saanuregh/trigger-sdk
```

## Usage

Create a `.ts` file in your actions directory (default `./actions/`):

```ts
import { defineAction, z } from "@saanuregh/trigger-sdk";

export default defineAction({
  name: "slack-notify",
  schema: z.object({
    webhook_url: z.string().url(),
    message: z.string(),
  }).strict(),
  handler: async (config, ctx) => {
    ctx.log("sending notification");
    const res = await fetch(config.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: config.message }),
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`Failed: ${res.status}`);
    return { output: { ok: true } };
  },
});
```

Actions are auto-discovered at startup. See the [examples](https://github.com/saanuregh/trigger/tree/main/examples/custom-actions) for more.

## License

[MIT](https://github.com/saanuregh/trigger/blob/main/LICENSE)
