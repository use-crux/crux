#!/usr/bin/env node

import { resolve } from "node:path";

import { validateReleaseAssets } from "./release/validate-release-assets.mjs";

const options = parseArgs(process.argv.slice(2));
const result = await validateReleaseAssets({
  version: required(options, "version"),
  sourceCommit: required(options, "source-commit"),
  outDir: resolve(options.out ?? ".tmp/github-release-assets"),
});

console.log(`Validated ${result.assets.length} GitHub Release assets.`);

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--help" || key === "-h") {
      console.log(`Usage: node scripts/validate-github-release-assets.mjs [options]

  --version <version>          Crux release version (required)
  --source-commit <sha>        Immutable source commit (required)
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
