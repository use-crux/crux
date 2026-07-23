#!/usr/bin/env node

import { appendFile } from "node:fs/promises";

import { decideNightlyRelease } from "./release/nightly-publication-policy.mjs";
import { inspectNightlyRelease } from "./release/nightly-release-inspection.mjs";
import { releaseNpmPackageNames } from "./release/npm-packages.mjs";
import {
  readNpmDistTagVersion,
  readPublishedNpmVersions,
} from "./release/npm-registry.mjs";

const options = parseArgs(process.argv.slice(2));
const eventName = required(options, "event-name");
const createdVersion = required(options, "created-version");
const sourceCommit = required(options, "source-commit");
const repo = options.repo ?? process.env.GITHUB_REPOSITORY;
if (!repo)
  throw new Error(
    "GitHub repository is required through --repo or GITHUB_REPOSITORY.",
  );

const packageNames = releaseNpmPackageNames();
const latestPublishedVersion =
  eventName === "schedule"
    ? readNpmDistTagVersion("@use-crux/core", "nightly")
    : undefined;
let publishedVersions = {};
let release;
if (
  latestPublishedVersion &&
  versionTargetsSource(latestPublishedVersion, sourceCommit)
) {
  publishedVersions = readPublishedNpmVersions(
    packageNames.map((name) => ({ name, version: latestPublishedVersion })),
  );
  release = await inspectNightlyRelease({
    version: latestPublishedVersion,
    repo,
  });
}

const decision = decideNightlyRelease({
  eventName,
  createdVersion,
  sourceCommit,
  latestPublishedVersion,
  packageNames,
  publishedVersions,
  release,
});
if (decision.kind === "fail")
  throw new Error(`Nightly publication is unsafe: ${decision.reason}`);

await writeGitHubOutput({
  action: decision.kind,
  version: decision.version,
  source_commit: decision.sourceCommit,
  should_build: `${decision.build}`,
  publish_npm: `${decision.publishNpm}`,
});
await writeStepSummary({ decision, createdVersion, latestPublishedVersion });
console.log(`Nightly action: ${decision.kind} (${decision.version}).`);

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") printHelpAndExit();
    if (!arg.startsWith("--") || index + 1 >= args.length)
      throw new Error(`Invalid argument: ${arg}`);
    options[arg.slice(2)] = args[++index];
  }
  return options;
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/decide-nightly-publication.mjs [options]

  --event-name <name>        GitHub event name (required)
  --created-version <value>  Newly generated nightly version (required)
  --source-commit <sha>      Full immutable source commit (required)
  --repo <owner/repo>        Repository (default: GITHUB_REPOSITORY)
`);
  process.exit(0);
}

function versionTargetsSource(version, sourceCommit) {
  const match = version.match(/\.sha([0-9a-f]{7,64})(?:\.|$)/i);
  return Boolean(
    match && sourceCommit.toLowerCase().startsWith(match[1].toLowerCase()),
  );
}

async function writeGitHubOutput(outputs) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `${Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
}

async function writeStepSummary({
  decision,
  createdVersion,
  latestPublishedVersion,
}) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `Nightly action: ${decision.kind}`,
      `Selected version: ${decision.version}`,
      `Created version: ${createdVersion}`,
      `Latest published nightly: ${latestPublishedVersion ?? "none"}`,
      `Build required: ${decision.build}`,
      `npm publication required: ${decision.publishNpm}`,
      "",
    ].join("\n"),
  );
}

function required(options, name) {
  const value = options[name];
  if (!value) throw new Error(`Missing required --${name}.`);
  return value;
}
