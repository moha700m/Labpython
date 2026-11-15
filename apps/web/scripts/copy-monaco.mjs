// Self-host Monaco (no CDN at runtime): copy monaco-editor/min/vs into public/monaco/vs.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve("monaco-editor/package.json")), "min", "vs");
const dest = join(here, "..", "public", "monaco", "vs");
if (!existsSync(join(dest, "loader.js"))) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log("monaco copied to public/monaco/vs");
}
