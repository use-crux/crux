import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { planReleaseAssetReconciliation } from "./release/asset-reconciliation-policy.mjs";
import { releaseAssetNames } from "./release/asset-names.mjs";
import { inspectNightlyRelease } from "./release/nightly-release-inspection.mjs";
import { decideNightlyRelease } from "./release/nightly-publication-policy.mjs";
import { releaseNpmPackageNames } from "./release/npm-packages.mjs";

const SOURCE_COMMIT = "abcdef0123456789abcdef0123456789abcdef01";
const CREATED_VERSION = "1.2.4-nightly.20260723030000.shaabcdef0";
const PUBLISHED_VERSION = "1.2.4-nightly.20260723020000.shaabcdef0";
const PACKAGE_NAMES = [
  "@use-crux/core",
  "@use-crux/local",
  "@use-crux/local-linux-x64",
];

test("nightly package completeness uses the release staging package set", () => {
  assert.deepEqual(releaseNpmPackageNames(), [
    "@use-crux/core",
    "@use-crux/ai",
    "@use-crux/anthropic",
    "@use-crux/cloudflare",
    "@use-crux/convex",
    "@use-crux/google",
    "@use-crux/indexer",
    "@use-crux/ingest",
    "@use-crux/next",
    "@use-crux/vercel",
    "@use-crux/mcp",
    "@use-crux/openai",
    "@use-crux/otel",
    "@use-crux/postgres",
    "@use-crux/react",
    "@use-crux/upstash",
    "@use-crux/local",
    "@use-crux/local-linux-x64",
    "@use-crux/local-linux-arm64",
    "@use-crux/local-darwin-x64",
    "@use-crux/local-darwin-arm64",
    "@use-crux/local-win32-x64",
    "@use-crux/local-win32-arm64",
  ]);
});

test("nightly publication decision covers new, complete, repair, and conflicts", async (t) => {
  const completeNpm = Object.fromEntries(
    PACKAGE_NAMES.map((name) => [name, PUBLISHED_VERSION]),
  );
  const cases = [
    {
      name: "new source publishes a new nightly",
      input: nightlyInput({
        latestPublishedVersion: "1.2.4-nightly.20260722020000.sha7654321",
      }),
      expected: action("publish", CREATED_VERSION, true, true),
    },
    {
      name: "exact npm and release matrix is complete",
      input: nightlyInput({
        latestPublishedVersion: PUBLISHED_VERSION,
        publishedVersions: completeNpm,
        release: releaseState("complete"),
      }),
      expected: action("complete", PUBLISHED_VERSION, false, false),
    },
    {
      name: "complete npm with a missing asset rebuilds for repair",
      input: nightlyInput({
        latestPublishedVersion: PUBLISHED_VERSION,
        publishedVersions: completeNpm,
        release: releaseState("missing"),
      }),
      expected: action("repair", PUBLISHED_VERSION, true, false),
    },
    {
      name: "partial npm set fails closed",
      input: nightlyInput({
        latestPublishedVersion: PUBLISHED_VERSION,
        publishedVersions: { "@use-crux/core": PUBLISHED_VERSION },
      }),
      expected: { kind: "fail", reason: "partial-npm" },
    },
    {
      name: "tag source conflict fails closed",
      input: nightlyInput({
        latestPublishedVersion: PUBLISHED_VERSION,
        publishedVersions: completeNpm,
        release: { ...releaseState("missing"), sourceCommit: "7654321" },
      }),
      expected: { kind: "fail", reason: "tag-source-conflict" },
    },
    {
      name: "checksum conflict fails closed",
      input: nightlyInput({
        latestPublishedVersion: PUBLISHED_VERSION,
        publishedVersions: completeNpm,
        release: releaseState("conflict"),
      }),
      expected: { kind: "fail", reason: "asset-conflict" },
    },
  ];

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, () => {
      assert.deepEqual(
        decideNightlyRelease(fixtureCase.input),
        fixtureCase.expected,
      );
    });
  }
});

test("nightly repair converges without npm publication", () => {
  const completeNpm = Object.fromEntries(
    PACKAGE_NAMES.map((name) => [name, PUBLISHED_VERSION]),
  );
  const repair = decideNightlyRelease(
    nightlyInput({
      latestPublishedVersion: PUBLISHED_VERSION,
      publishedVersions: completeNpm,
      release: releaseState("missing"),
    }),
  );
  assert.deepEqual(repair, action("repair", PUBLISHED_VERSION, true, false));

  assert.deepEqual(
    planReleaseAssetReconciliation({
      releaseExists: true,
      expectedAssets: [
        { name: "SHA256SUMS", sha256: "a".repeat(64) },
        { name: "crux.zip", sha256: "b".repeat(64) },
      ],
      existingAssets: [{ name: "SHA256SUMS", sha256: "a".repeat(64) }],
    }),
    { kind: "apply", createRelease: false, uploadNames: ["crux.zip"] },
  );

  assert.deepEqual(
    decideNightlyRelease(
      nightlyInput({
        latestPublishedVersion: PUBLISHED_VERSION,
        publishedVersions: completeNpm,
        release: releaseState("complete"),
      }),
    ),
    action("complete", PUBLISHED_VERSION, false, false),
  );
});

test("nightly workflow rebuilds repairs from immutable source and skips npm", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const nightly = workflow.slice(workflow.indexOf("  nightly:"));
  assert.match(nightly, /decide-nightly-publication\.mjs/);
  assert.match(nightly, /if: needs\.nightly\.outputs\.shouldBuild == 'true'/);
  assert.ok(
    nightly.match(/ref: \$\{\{ needs\.nightly\.outputs\.sourceSha \}\}/g)
      ?.length >= 3,
  );
  assert.match(nightly, /if: needs\.nightly\.outputs\.publishNpm == 'true'/);
  assert.match(
    nightly,
    /release:publish-staged -- --no-skip-existing --npm-tag nightly/,
  );
  assert.match(nightly, /release:assets:reconcile --[\s\S]*--prerelease/);
  assert.doesNotMatch(
    nightly,
    /nightly_packages|shouldPublish|gh release create/,
  );

  const assetStage = nightly.indexOf(
    "Stage and validate nightly GitHub Release assets",
  );
  const npmPublish = nightly.indexOf("Publish nightly npm packages");
  assert.ok(assetStage >= 0 && assetStage < npmPublish);
});

test("nightly release inspection verifies downloaded checksum bytes", async () => {
  assert.deepEqual(
    await inspectNightlyRelease({
      version: PUBLISHED_VERSION,
      repo: "use-crux/crux",
      spawn: nightlyGhStub(false),
    }),
    releaseState("complete"),
  );
  assert.deepEqual(
    await inspectNightlyRelease({
      version: PUBLISHED_VERSION,
      repo: "use-crux/crux",
      spawn: nightlyGhStub(true),
    }),
    releaseState("conflict"),
  );
});

function nightlyInput(overrides = {}) {
  return {
    eventName: "schedule",
    createdVersion: CREATED_VERSION,
    sourceCommit: SOURCE_COMMIT,
    latestPublishedVersion: undefined,
    packageNames: PACKAGE_NAMES,
    publishedVersions: {},
    release: undefined,
    ...overrides,
  };
}

function releaseState(assetState) {
  return {
    sourceCommit: SOURCE_COMMIT,
    isPrerelease: true,
    isDraft: false,
    assetState,
  };
}

function action(kind, version, build, publishNpm) {
  return { kind, version, sourceCommit: SOURCE_COMMIT, build, publishNpm };
}

function nightlyGhStub(corruptChecksums) {
  const contract = releaseAssetNames(PUBLISHED_VERSION);
  const names = [
    contract.extension,
    ...contract.archives,
    contract.checksums,
  ].sort();
  return (_command, args) => {
    if (args[0] === "release" && args[1] === "view") {
      return {
        status: 0,
        stdout: JSON.stringify({
          assets: names.map((name) => ({ name })),
          isDraft: false,
          isPrerelease: true,
        }),
        stderr: "",
      };
    }
    if (args[0] === "api")
      return { status: 0, stdout: `${SOURCE_COMMIT}\n`, stderr: "" };
    if (args[0] === "release" && args[1] === "download") {
      const destination = args[args.indexOf("--dir") + 1];
      const payloadNames = names.filter((name) => name !== "SHA256SUMS");
      const rows = payloadNames.map((name, index) => {
        const bytes = Buffer.from(`fixture:${name}\n`);
        writeFileSync(join(destination, name), bytes);
        const hash =
          corruptChecksums && index === 0
            ? "0".repeat(64)
            : createHash("sha256").update(bytes).digest("hex");
        return `${hash}  ${name}`;
      });
      writeFileSync(join(destination, "SHA256SUMS"), `${rows.join("\n")}\n`);
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected gh arguments: ${args.join(" ")}`);
  };
}
