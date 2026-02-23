import { rmSync } from "node:fs";
import tailwind from "bun-plugin-tailwind";

// Clean previous build output
rmSync("dist", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["index.ts", "public/index.html"],
  outdir: "dist",
  target: "bun",
  minify: true,
  sourcemap: "external",
  drop: ["debugger"],
  plugins: [tailwind],
});

if (!result.success) {
  for (const msg of result.logs) console.error(msg);
  process.exit(1);
}

// Bundle the SDK so it's self-contained (no relative imports to src/)
const sdkResult = await Bun.build({
  entrypoints: ["packages/trigger-sdk/index.ts"],
  outdir: "dist/@saanuregh/trigger-sdk",
  target: "bun",
  minify: false,
  external: ["zod"],
});

if (!sdkResult.success) {
  for (const msg of sdkResult.logs) console.error(msg);
  process.exit(1);
}

// Write a complete package.json for the published SDK
const sdkPkg = await Bun.file("packages/trigger-sdk/package.json").json();
await Bun.write(
  "dist/@saanuregh/trigger-sdk/package.json",
  JSON.stringify({
    name: sdkPkg.name,
    version: sdkPkg.version,
    main: "index.js",
    type: "module",
    peerDependencies: sdkPkg.peerDependencies,
    peerDependenciesMeta: sdkPkg.peerDependenciesMeta,
    dependencies: { zod: sdkPkg.dependencies.zod },
  }),
);

// Add shebang to the CLI entry point so `bunx` works
const indexPath = "dist/index.js";
const indexContent = await Bun.file(indexPath).text();
await Bun.write(indexPath, `#!/usr/bin/env bun\n${indexContent}`);

// Write package.json for the main binary
const rootPkg = await Bun.file("package.json").json();
await Bun.write(
  "dist/package.json",
  JSON.stringify({
    name: rootPkg.name,
    version: rootPkg.version,
    type: "module",
    bin: { trigger: "index.js" },
    files: ["index.js", "chunk-*", "public/"],
  }),
);

console.log(`Built ${result.outputs.length + sdkResult.outputs.length} files`);
