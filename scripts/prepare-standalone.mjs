import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const nextDirectory = process.env.NEXT_DIST_DIR || ".next";
const standaloneRoot = join(root, nextDirectory, "standalone");

if (!existsSync(standaloneRoot)) {
  throw new Error("Standalone build output was not found. Run next build first.");
}

const assets = [
  [join(root, nextDirectory, "static"), join(standaloneRoot, nextDirectory, "static")],
  [join(root, "public"), join(standaloneRoot, "public")],
];

function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, destinationPath);
    else copyFileSync(sourcePath, destinationPath);
  }
}

for (const [source, destination] of assets) {
  if (!existsSync(source)) continue;
  rmSync(destination, { recursive: true, force: true });
  copyDirectory(source, destination);
}

console.log("Copied static assets into the standalone build.");
