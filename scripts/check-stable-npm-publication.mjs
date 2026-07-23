#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { decideStableNpmPublication } from "./release/npm-publication-policy.mjs";
import { readPublishedNpmVersions } from "./release/npm-registry.mjs";

const options = parseArgs(process.argv.slice(2));
const stageRoot = resolve(options.stageRoot ?? ".tmp/npm-stage");
const index = JSON.parse(
  await readFile(resolve(stageRoot, "packages.json"), "utf8"),
);
const packages = index.packages.map(({ name, version }) => ({ name, version }));
const releaseVersion = options.releaseVersion ?? releaseVersionFrom(packages);
const publishedVersions = readPublishedNpmVersions(packages, {
  registry: options.registry,
});
const decision = decideStableNpmPublication({
  releaseVersion,
  packages,
  publishedVersions,
});

if (decision.kind === "fail") {
  throw new Error(
    `Stable npm publication is unsafe (${decision.reason}): ${decision.packageNames.join(", ") || "empty staged set"}`,
  );
}

await writeGitHubOutput({ action: decision.kind, version: releaseVersion });
console.log(
  `Stable npm action: ${decision.kind} (${packages.length} staged packages at ${releaseVersion}).`,
);

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--stage-root") options.stageRoot = args[++index];
    else if (arg === "--release-version")
      options.releaseVersion = args[++index];
    else if (arg === "--registry") options.registry = args[++index];
    else if (arg === "--") continue;
    else if (arg === "--help" || arg === "-h") printHelpAndExit();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/check-stable-npm-publication.mjs [options]

  --stage-root <dir>         Staged npm root (default: .tmp/npm-stage)
  --release-version <value> Lockstep version (default: @use-crux/core staged version)
  --registry <url>          Optional npm registry override
`);
  process.exit(0);
}

function releaseVersionFrom(packages) {
  const core = packages.find(({ name }) => name === "@use-crux/core");
  if (!core?.version)
    throw new Error(
      "Staged npm set does not contain @use-crux/core with a version.",
    );
  return core.version;
}

async function writeGitHubOutput(outputs) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(outputs).map(
    ([key, value]) => `${key}=${value}`,
  );
  await appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}
