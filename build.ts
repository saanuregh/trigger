import tailwind from "bun-plugin-tailwind";

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
  outdir: "dist/trigger-sdk",
  target: "bun",
  minify: false,
  external: ["zod"],
});

if (!sdkResult.success) {
  for (const msg of sdkResult.logs) console.error(msg);
  process.exit(1);
}

// Write a package.json so `import "trigger-sdk"` resolves correctly
await Bun.write("dist/trigger-sdk/package.json", JSON.stringify({ name: "trigger-sdk", main: "index.js" }));

console.log(`Built ${result.outputs.length + sdkResult.outputs.length} files`);
