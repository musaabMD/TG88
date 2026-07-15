import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const result = await build({
  entryPoints: ["src/ui.tsx"],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "TG88Ui",
  platform: "browser",
  target: ["es2022"],
  write: false,
  loader: {
    ".tsx": "tsx",
    ".ts": "ts"
  }
});

const text = result.outputFiles[0].text;
await mkdir("src/generated", { recursive: true });
await writeFile(
  "src/generated/ui-bundle.ts",
  `export const UI_BUNDLE = ${JSON.stringify(text)};\n`
);
