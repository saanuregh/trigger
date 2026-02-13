import tailwind from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: ["index.ts", "public/index.html"],
  outdir: "dist",
  target: "bun",
  minify: true,
  drop: ["debugger"],
  plugins: [tailwind],
});

if (!result.success) {
  for (const msg of result.logs) console.error(msg);
  process.exit(1);
}

console.log(`Built ${result.outputs.length} files`);
