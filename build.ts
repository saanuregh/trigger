import tailwind from "bun-plugin-tailwind";

const htmlEntries = Array.from(new Bun.Glob("public/*.html").scanSync("."));

const result = await Bun.build({
  entrypoints: ["index.ts", ...htmlEntries],
  outdir: "dist",
  target: "bun",
  plugins: [tailwind],
});

if (!result.success) {
  for (const msg of result.logs) console.error(msg);
  process.exit(1);
}

console.log(`Built ${result.outputs.length} files`);
