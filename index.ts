import { parseArgs } from "util";

const { positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  strict: false,
});

const command = positionals[0];

switch (command) {
  case "start": {
    const { startServer } = await import("./src/server/index.ts");
    await startServer();
    break;
  }

  case "validate": {
    const files = positionals.slice(1);
    if (files.length === 0) {
      console.error("Usage: trigger validate <file.yaml> [file2.yaml ...]");
      process.exit(1);
    }

    const { env } = await import("./src/env.ts");
    const { logger } = await import("./src/logger.ts");
    const { initBuiltinActions } = await import("./src/pipeline/executor.ts");
    const { loadCustomActions } = await import("./src/pipeline/action-loader.ts");
    const { rebuildConfigSchema, getActiveSchema } = await import("./src/config/loader.ts");

    logger.level = "silent";
    initBuiltinActions();
    await loadCustomActions(env.ACTIONS_DIR);
    rebuildConfigSchema();

    const schema = getActiveSchema();
    let hasErrors = false;

    for (const file of files) {
      const bunFile = Bun.file(file);
      if (!(await bunFile.exists())) {
        console.error(`\x1b[31m✗\x1b[0m ${file}: file not found`);
        hasErrors = true;
        continue;
      }

      const text = await bunFile.text();
      let parsed: unknown;
      try {
        parsed = Bun.YAML.parse(text);
      } catch (err) {
        console.error(`\x1b[31m✗\x1b[0m ${file}: YAML parse error — ${err instanceof Error ? err.message : err}`);
        hasErrors = true;
        continue;
      }

      const result = schema.safeParse(parsed);
      if (result.success) {
        console.log(`\x1b[32m✓\x1b[0m ${file}`);
      } else {
        hasErrors = true;
        console.error(`\x1b[31m✗\x1b[0m ${file}:`);
        for (const issue of result.error.issues) {
          console.error(`    ${issue.path.join(".") || "/"}: ${issue.message}`);
        }
      }
    }

    process.exit(hasErrors ? 1 : 0);
    break;
  }

  default:
    console.error(
      `Usage: trigger <command>

Commands:
  start       Start the server
  validate    Validate YAML pipeline config files

Examples:
  bun index.ts start
  bun index.ts validate configs/*.yaml`,
    );
    process.exit(1);
}
