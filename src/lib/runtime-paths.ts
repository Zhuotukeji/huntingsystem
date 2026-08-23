import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export function resolveApplicationRoot(currentDirectory = process.cwd()) {
  const normalized = resolve(currentDirectory);
  if (basename(normalized).toLowerCase() === "standalone" && basename(dirname(normalized)).toLowerCase() === ".next") {
    return resolve(normalized, "..", "..");
  }
  return normalized;
}

export const applicationRoot = resolveApplicationRoot();

export function applicationPath(...segments: string[]) {
  return join(applicationRoot, ...segments);
}

export function configuredApplicationPath(value: string) {
  return isAbsolute(value) ? value : resolve(applicationRoot, value);
}
