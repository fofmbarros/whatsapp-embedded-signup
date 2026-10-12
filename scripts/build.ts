import { build } from "bun";

const result = await build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "browser",
  format: "esm",
  banner: '"use client";',
  external: ["react", "react/jsx-runtime"],
  minify: false,
});
if (!result.success) throw new AggregateError(result.logs, "Package build failed");
