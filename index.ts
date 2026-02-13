import { parseArgs } from "node:util";

const { positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  strict: false,
});

const command = positionals[0];

switch (command) {
  case "start": {
    const { startServer } = await import("./src/server/index.ts");
    startServer();
    break;
  }

  case "schema": {
    const { z } = await import("zod");
    const { pipelineConfigSchema } = await import("./src/config/schema.ts");
    const outputPath = positionals[1] ?? "schema/pipeline-config.schema.json";
    const schema = z.toJSONSchema(pipelineConfigSchema);
    await Bun.write(outputPath, `${JSON.stringify(schema, null, 2)}\n`);
    console.log(`Schema written to ${outputPath}`);
    break;
  }

  default:
    console.error(
      `Usage: trigger <command>

Commands:
  start     Start the server
  schema    Generate JSON Schema file (default: docs/pipeline-config.schema.json)

Examples:
  bun index.ts start
  bun index.ts schema
  bun index.ts schema path/to/output.json`,
    );
    process.exit(1);
}
