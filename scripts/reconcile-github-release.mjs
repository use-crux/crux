#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { planReleaseAssetReconciliation } from "./release/asset-reconciliation-policy.mjs";
import { readPublicReleaseAssets } from "./release/public-assets.mjs";

const options = parseArgs(process.argv.slice(2));
const tag = required(options, "tag");
const title = required(options, "title");
const notesFile = resolve(required(options, "notes-file"));
const sourceCommit = required(options, "source-commit");
const prerelease = options.prerelease === true;
const repo = options.repo ?? process.env.GITHUB_REPOSITORY;
if (!repo)
  throw new Error(
    "GitHub repository is required through --repo or GITHUB_REPOSITORY.",
  );

const publicDir = resolve(
  options["asset-root"] ?? ".tmp/github-release-assets",
  "public",
);
const expectedAssets = await readPublicReleaseAssets(publicDir);
const release = viewRelease(tag, repo);
if (release) {
  verifyExistingTagSource(tag, sourceCommit);
  if (release.isDraft || release.isPrerelease !== prerelease) {
    throw new Error(
      `Existing release ${tag} has incompatible draft/prerelease metadata.`,
    );
  }
}

const existingNames = release?.assets.map(({ name }) => name) ?? [];
const expectedNames = new Set(expectedAssets.map(({ name }) => name));
const unexpected = existingNames.filter((name) => !expectedNames.has(name));
if (unexpected.length > 0) {
  throw new Error(
    `GitHub Release contains unexpected immutable assets: ${unexpected.sort().join(", ")}`,
  );
}

const workspace = await mkdtemp(join(tmpdir(), "crux-release-reconcile-"));
try {
  const existingAssets = release
    ? await downloadAssetIdentities(tag, repo, existingNames, workspace)
    : [];
  const plan = planReleaseAssetReconciliation({
    releaseExists: Boolean(release),
    expectedAssets,
    existingAssets,
  });
  if (plan.kind === "fail") {
    throw new Error(
      `GitHub Release reconciliation failed (${plan.reason}): ${plan.assetNames.join(", ")}`,
    );
  }

  if (plan.createRelease) {
    const createArgs = [
      "release",
      "create",
      tag,
      "--repo",
      repo,
      "--target",
      sourceCommit,
      "--title",
      title,
      "--notes-file",
      notesFile,
    ];
    if (prerelease) createArgs.push("--prerelease", "--latest=false");
    run("gh", createArgs);
  } else {
    const editArgs = [
      "release",
      "edit",
      tag,
      "--repo",
      repo,
      "--title",
      title,
      "--notes-file",
      notesFile,
    ];
    if (prerelease) editArgs.push("--prerelease", "--latest=false");
    run("gh", editArgs);
  }

  if (plan.uploadNames.length > 0) {
    run("gh", [
      "release",
      "upload",
      tag,
      ...plan.uploadNames.map((name) => join(publicDir, name)),
      "--repo",
      repo,
    ]);
  }
  console.log(
    `Reconciled ${expectedAssets.length} immutable assets for ${tag}.`,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}

function viewRelease(tag, repo) {
  const result = spawnSync(
    "gh",
    [
      "release",
      "view",
      tag,
      "--repo",
      repo,
      "--json",
      "assets,isDraft,isPrerelease,tagName",
    ],
    {
      encoding: "utf8",
    },
  );
  if (result.status === 0) return JSON.parse(result.stdout);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/release not found|HTTP\s+404|Not Found/i.test(output)) return undefined;
  throw new Error(`Unable to inspect GitHub Release ${tag}: ${output.trim()}`);
}

async function downloadAssetIdentities(tag, repo, names, workspace) {
  if (names.length === 0) return [];
  const args = ["release", "download", tag, "--repo", repo, "--dir", workspace];
  for (const name of names) args.push("--pattern", name);
  run("gh", args);
  const identities = [];
  for (const name of names) {
    identities.push({
      name,
      sha256: sha256(await readFile(join(workspace, name))),
    });
  }
  return identities;
}

function verifyExistingTagSource(tag, sourceCommit) {
  const result = spawnSync("git", ["rev-parse", `${tag}^{commit}`], {
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(
      `Existing release tag ${tag} is unavailable in the full checkout.`,
    );
  const actual = result.stdout.trim().toLowerCase();
  const expected = sourceCommit.toLowerCase();
  if (actual !== expected && !actual.startsWith(expected)) {
    throw new Error(
      `Existing release tag ${tag} resolves to ${actual}, want ${sourceCommit}.`,
    );
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") printHelpAndExit();
    if (arg === "--prerelease") {
      options.prerelease = true;
      continue;
    }
    if (!arg.startsWith("--") || index + 1 >= args.length)
      throw new Error(`Invalid argument: ${arg}`);
    options[arg.slice(2)] = args[++index];
  }
  return options;
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/reconcile-github-release.mjs [options]

  --tag <tag>                Release tag (required)
  --title <title>            Release title (required)
  --notes-file <path>        Release notes file (required)
  --source-commit <sha>      Immutable source commit (required)
  --asset-root <dir>         Staged asset root (default: .tmp/github-release-assets)
  --repo <owner/repo>        Repository (default: GITHUB_REPOSITORY)
  --prerelease               Require/create a non-draft prerelease
`);
  process.exit(0);
}

function required(options, name) {
  const value = options[name];
  if (!value) throw new Error(`Missing required --${name}.`);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status ?? "signal"}): ${result.stderr || result.stdout}`,
    );
  }
}
