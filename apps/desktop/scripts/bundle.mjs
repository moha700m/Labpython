// Bundles the desktop server into one ESM file and copies the web UI + templates next to it.
// Output: apps/desktop/dist/app/{server.mjs, web/, templates/}
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const out = join(here, "..", "dist", "app");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(here, "..", "src", "server.ts")],
  outfile: join(out, "server.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  legalComments: "none",
  // Some CommonJS dependencies call require(); give the ESM bundle a real one.
  banner: { js: "import { createRequire as __mcsCreateRequire } from 'node:module'; const require = __mcsCreateRequire(import.meta.url);" },
  logLevel: "warning",
});

const web = join(root, "apps", "web", "out");
if (!existsSync(join(web, "index.html"))) throw new Error("Build the web app first: pnpm --filter @mcs/web build");
cpSync(web, join(out, "web"), { recursive: true });
cpSync(join(root, "templates"), join(out, "templates"), { recursive: true });
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
console.log("bundled →", out);
