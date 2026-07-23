import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { releaseAssetNames } from "./asset-names.mjs";

/**
 * Inspects a nightly prerelease and verifies its complete checksum matrix.
 * Missing releases/assets remain repairable; malformed or conflicting bytes
 * are reported as conflicts so callers fail closed.
 */
export async function inspectNightlyRelease({
  version,
  repo,
  spawn = spawnSync,
}) {
  const tag = `v${version}`;
  const release = viewRelease(tag, repo, spawn);
  if (!release) return undefined;

  const sourceCommit = readTagSource(tag, repo, spawn);
  const expectedNames = expectedAssetNames(version);
  const actualNames = release.assets.map(({ name }) => name).sort();
  let assetState = "missing";
  if (
    new Set(actualNames).size !== actualNames.length ||
    actualNames.some((name) => !expectedNames.includes(name))
  ) {
    assetState = "conflict";
  } else if (sameStrings(actualNames, expectedNames)) {
    assetState = (await releaseChecksumsMatch(tag, repo, version, spawn))
      ? "complete"
      : "conflict";
  }

  return {
    sourceCommit,
    isPrerelease: release.isPrerelease,
    isDraft: release.isDraft,
    assetState,
  };
}

function viewRelease(tag, repo, spawn) {
  const result = spawn(
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
    { encoding: "utf8" },
  );
  if (result.status === 0) return JSON.parse(result.stdout);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/release not found|HTTP\s+404|Not Found/i.test(output)) return undefined;
  throw new Error(`Unable to inspect nightly release ${tag}: ${output.trim()}`);
}

function readTagSource(tag, repo, spawn) {
  const result = spawn(
    "gh",
    ["api", `repos/${repo}/git/ref/tags/${tag}`, "--jq", ".object.sha"],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Unable to resolve nightly tag ${tag}: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

async function releaseChecksumsMatch(tag, repo, version, spawn) {
  const workspace = await mkdtemp(join(tmpdir(), "crux-nightly-inspect-"));
  try {
    run(
      "gh",
      ["release", "download", tag, "--repo", repo, "--dir", workspace],
      spawn,
    );
    const rows = parseChecksums(
      await readFile(join(workspace, "SHA256SUMS"), "utf8"),
    );
    const expectedPayloadNames = expectedAssetNames(version).filter(
      (name) => name !== "SHA256SUMS",
    );
    if (!sameStrings([...rows.keys()].sort(), expectedPayloadNames))
      return false;
    for (const [name, expectedHash] of rows) {
      const actualHash = sha256(await readFile(join(workspace, name)));
      if (actualHash !== expectedHash) return false;
    }
    return true;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function expectedAssetNames(version) {
  const names = releaseAssetNames(version);
  return [names.extension, ...names.archives, names.checksums].sort();
}

function parseChecksums(contents) {
  const rows = contents
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})  (.+)$/);
      if (!match)
        throw new Error(`Malformed nightly SHA256SUMS entry: ${line}`);
      return [match[2], match[1]];
    });
  const checksums = new Map(rows);
  return checksums.size === rows.length ? checksums : new Map();
}

function sameStrings(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command, args, spawn) {
  const result = spawn(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status ?? "signal"}): ${result.stderr || result.stdout}`,
    );
  }
}
