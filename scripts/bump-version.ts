#!/usr/bin/env bun
// scripts/bump-version.ts — Bump version across all packages
// Usage: bun scripts/bump-version.ts <version>
// Example: bun scripts/bump-version.ts 0.0.3

import { resolve } from "node:path";

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error("Usage: bun scripts/bump-version.ts <version>");
  console.error("Example: bun scripts/bump-version.ts 0.0.3");
  process.exit(1);
}

const packages = [
  "package.json",
  "packages/core/package.json",
  "packages/ui/package.json",
  "packages/app/package.json",
  "packages/vscode/package.json",
];

for (const pkg of packages) {
  const path = resolve(pkg);
  const json = await Bun.file(path).json();
  const oldVersion = json.version;
  json.version = newVersion;
  await Bun.write(path, JSON.stringify(json, null, 2) + "\n");
  console.log(`${pkg}: ${oldVersion} → ${newVersion}`);
}

// Also update workspace versions in bun.lock
const lockPath = resolve("bun.lock");
let lock = await Bun.file(lockPath).text();
const workspaceVersions: [string, string][] = [
  ["@codepawl/yeastbook", "packages/app"],
  ["@codepawl/yeastbook-core", "packages/core"],
  ["@codepawl/yeastbook-ui", "packages/ui"],
  ["vscode-yeastbook", "packages/vscode"],
];
for (const [name, dir] of workspaceVersions) {
  // Match the version line right after the workspace name line
  const pattern = new RegExp(`("${dir}":\\s*\\{[^}]*?"version":\\s*")\\d+\\.\\d+\\.\\d+(")`);
  lock = lock.replace(pattern, `$1${newVersion}$2`);
}
await Bun.write(lockPath, lock);
console.log(`bun.lock: workspace versions → ${newVersion}`);

console.log(`\nAll packages bumped to ${newVersion}`);
console.log(`Next: git add -A && git commit -m "chore: bump version to ${newVersion}" && git tag v${newVersion} && git push origin staging --tags`);
