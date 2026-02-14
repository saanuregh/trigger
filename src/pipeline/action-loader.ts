import { resolve } from "node:path";
import { logger } from "../logger.ts";
import { registerAction } from "./action-registry.ts";

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const tsGlob = new Bun.Glob("*.ts");

export async function loadCustomActions(dir: string): Promise<void> {
  const absDir = resolve(dir);
  let files: string[];
  try {
    files = [...tsGlob.scanSync({ cwd: absDir, onlyFiles: true })].filter((f) => !f.endsWith(".d.ts")).sort();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      logger.info({ dir: absDir }, "custom actions directory does not exist, skipping");
    } else {
      logger.error({ dir: absDir, error: err instanceof Error ? err.message : String(err) }, "failed to scan custom actions directory");
    }
    return;
  }

  if (files.length === 0) {
    logger.info({ dir: absDir }, "no custom actions found");
    return;
  }

  logger.info({ dir: absDir, count: files.length }, "loading custom actions");

  for (const file of files) {
    const filePath = `${absDir}/${file}`;
    try {
      const mod = await import(filePath);
      const def = mod.default;

      if (!def || typeof def !== "object" || typeof def.name !== "string" || typeof def.handler !== "function" || !def.schema) {
        logger.error({ file }, "custom action missing required exports (name, schema, handler)");
        continue;
      }

      if (!NAME_RE.test(def.name)) {
        logger.error({ file, name: def.name }, "custom action name must match /^[a-z][a-z0-9-]*$/");
        continue;
      }

      registerAction({
        name: def.name,
        schema: def.schema,
        handler: def.handler,
        builtin: false,
      });
    } catch (err) {
      logger.error({ file, error: err instanceof Error ? err.message : String(err) }, "failed to load custom action");
    }
  }
}
