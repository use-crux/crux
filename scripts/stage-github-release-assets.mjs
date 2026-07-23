#!/usr/bin/env node

import { resolve } from "node:path";

import { stageReleaseAssets } from "./release/stage-release-assets.mjs";

const options = parseArgs(process.argv.slice(2));
const outDir = resolve(options.out ?? ".tmp/github-release-assets");
await stageReleaseAssets({
  version: required(options, "version"),
  sourceCommit: required(options, "source-commit"),
  nativeRoot: resolve(options["native-root"] ?? "packages/local/dist"),
  extensionDir: resolve(options["extension-dir"] ?? "packages/vscode"),
  outDir,
});

console.log(`Staged GitHub Release assets in ${outDir}`);

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--help" || key === "-h") {
      console.log(`Usage: node scripts/stage-github-release-assets.mjs [options]

  --version <version>          Crux release version (required)
  --source-commit <sha>        Immutable source commit (required)
  --native-root <dir>          Native bundle root (default: packages/local/dist)
  --extension-dir <dir>        Built extension source (default: packages/vscode)
  --out <dir>                  Output root (default: .tmp/github-release-assets)
`);
      process.exit(0);
    }
    if (!key.startsWith("--") || index + 1 >= args.length)
      throw new Error(`Invalid argument: ${key}`);
    options[key.slice(2)] = args[++index];
  }
  return options;
}

function required(options, name) {
  const value = options[name];
  if (!value) throw new Error(`Missing required --${name}.`);
  return value;
}
