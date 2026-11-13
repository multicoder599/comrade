// Copies the better-sqlite3 native addon next to the server bundle so the
// production build is self-contained (Kimi deploys dist/ without node_modules).
//
// The `bindings` package finds its "module root" by walking up from the calling
// file (dist/boot.js) to the nearest package.json, then looks for
// <root>/build/Release/better_sqlite3.node. We therefore:
//   1. write a minimal dist/package.json so the walk-up stops at dist/
//   2. place the addon at dist/build/Release/better_sqlite3.node
//   3. also copy it to <projectRoot>/build/Release/ as a fallback when running
//      from the project checkout on a VPS
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, "..");
const src = path.join(
  projectRoot,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node"
);

writeFileSync(
  path.join(projectRoot, "dist", "package.json"),
  JSON.stringify({ name: "comrade-shop-pos-server", type: "module" }, null, 2) + "\n"
);

for (const destDir of [
  path.join(projectRoot, "dist", "build", "Release"),
  path.join(projectRoot, "build", "Release"),
]) {
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, path.join(destDir, "better_sqlite3.node"));
}

console.log(
  "postbuild: dist/package.json written; better_sqlite3.node copied to dist/build/Release and build/Release"
);
