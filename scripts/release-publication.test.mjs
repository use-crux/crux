import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { planReleaseAssetReconciliation } from "./release/asset-reconciliation-policy.mjs";
import { decideStableNpmPublication } from "./release/npm-publication-policy.mjs";
import {
  readNpmDistTagVersion,
  readPublishedNpmVersions,
} from "./release/npm-registry.mjs";

const VERSION = "1.2.3";
const PACKAGES = [
  { name: "@use-crux/core", version: VERSION },
  { name: "@use-crux/local", version: VERSION },
  { name: "@use-crux/local-linux-x64", version: VERSION },
];

test("stable npm completeness policy fails closed", async (t) => {
  const cases = [
    {
      name: "none published starts one complete publish",
      publishedVersions: {},
      expected: {
        kind: "publish",
        packageNames: PACKAGES.map(({ name }) => name),
      },
    },
    {
      name: "complete exact set skips npm for asset repair",
      publishedVersions: Object.fromEntries(
        PACKAGES.map(({ name, version }) => [name, version]),
      ),
      expected: { kind: "assets-only", packageNames: [] },
    },
    {
      name: "partial exact set fails before publication",
      publishedVersions: { "@use-crux/core": VERSION },
      expected: {
        kind: "fail",
        reason: "partial",
        packageNames: [
          "@use-crux/core",
          "@use-crux/local",
          "@use-crux/local-linux-x64",
        ],
      },
    },
    {
      name: "unexpected registry version fails before publication",
      publishedVersions: {
        "@use-crux/core": VERSION,
        "@use-crux/local": "1.2.2",
        "@use-crux/local-linux-x64": VERSION,
      },
      expected: {
        kind: "fail",
        reason: "registry-version-mismatch",
        packageNames: ["@use-crux/local"],
      },
    },
  ];

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, () => {
      assert.deepEqual(
        decideStableNpmPublication({
          releaseVersion: VERSION,
          packages: PACKAGES,
          publishedVersions: fixtureCase.publishedVersions,
        }),
        fixtureCase.expected,
      );
    });
  }
});

test("stable npm policy rejects staged package version drift", () => {
  assert.deepEqual(
    decideStableNpmPublication({
      releaseVersion: VERSION,
      packages: [...PACKAGES, { name: "@use-crux/ai", version: "9.9.9" }],
      publishedVersions: {},
    }),
    {
      kind: "fail",
      reason: "staged-version-mismatch",
      packageNames: ["@use-crux/ai"],
    },
  );
});

test("immutable GitHub asset reconciliation is repairable and fail-closed", async (t) => {
  const expectedAssets = [
    { name: "SHA256SUMS", sha256: "a".repeat(64) },
    { name: "crux-vscode-1.2.3.vsix", sha256: "b".repeat(64) },
  ];
  const cases = [
    {
      name: "new release uploads the complete set",
      releaseExists: false,
      existingAssets: [],
      expected: {
        kind: "apply",
        createRelease: true,
        uploadNames: ["SHA256SUMS", "crux-vscode-1.2.3.vsix"],
      },
    },
    {
      name: "complete identical release is idempotent",
      releaseExists: true,
      existingAssets: expectedAssets,
      expected: { kind: "apply", createRelease: false, uploadNames: [] },
    },
    {
      name: "missing asset is repaired without replacing identical bytes",
      releaseExists: true,
      existingAssets: [expectedAssets[0]],
      expected: {
        kind: "apply",
        createRelease: false,
        uploadNames: ["crux-vscode-1.2.3.vsix"],
      },
    },
    {
      name: "conflicting immutable bytes fail",
      releaseExists: true,
      existingAssets: [{ name: "SHA256SUMS", sha256: "c".repeat(64) }],
      expected: {
        kind: "fail",
        reason: "checksum-conflict",
        assetNames: ["SHA256SUMS"],
      },
    },
    {
      name: "unexpected release asset fails",
      releaseExists: true,
      existingAssets: [{ name: "old.zip", sha256: "d".repeat(64) }],
      expected: {
        kind: "fail",
        reason: "unexpected-asset",
        assetNames: ["old.zip"],
      },
    },
  ];

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, () => {
      assert.deepEqual(
        planReleaseAssetReconciliation({
          releaseExists: fixtureCase.releaseExists,
          expectedAssets,
          existingAssets: fixtureCase.existingAssets,
        }),
        fixtureCase.expected,
      );
    });
  }
});

test("npm registry adapter distinguishes exact, absent, and failed reads", () => {
  const packages = PACKAGES.slice(0, 2);
  const published = readPublishedNpmVersions(packages, {
    spawn: (_command, args) =>
      args[1].startsWith("@use-crux/core@")
        ? { status: 0, stdout: `"${VERSION}"\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "npm error code E404" },
  });
  assert.deepEqual(published, {
    "@use-crux/core": VERSION,
    "@use-crux/local": undefined,
  });
  assert.equal(
    readNpmDistTagVersion("@use-crux/core", "nightly", {
      spawn: (_command, args) => {
        assert.equal(args[1], "@use-crux/core@nightly");
        return { status: 0, stdout: `"${VERSION}"\n`, stderr: "" };
      },
    }),
    VERSION,
  );

  assert.throws(
    () =>
      readPublishedNpmVersions(packages.slice(0, 1), {
        spawn: () => ({ status: 1, stdout: "", stderr: "network unavailable" }),
      }),
    /npm view failed/,
  );
});

test("stable workflow validates every artifact before external publication", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const stable = workflow.slice(
    workflow.indexOf("  publish:"),
    workflow.indexOf("  nightly:"),
  );
  const orderedSteps = [
    "Test, typecheck, and build editor extension",
    "Stage and validate npm packages",
    "Decide stable npm publication",
    "Stage and validate GitHub Release assets",
    "Publish staged npm packages",
    "Reconcile GitHub Release and immutable assets",
  ];
  const positions = orderedSteps.map((step) => stable.indexOf(step));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    [...positions].sort((left, right) => left - right),
    positions,
  );
  assert.match(stable, /if: steps\.npm-state\.outputs\.action == 'publish'/);
  assert.match(stable, /release:publish-staged -- --no-skip-existing/);
  assert.match(stable, /release:assets:reconcile/);
  assert.doesNotMatch(stable, /gh release (?:create|edit|upload)/);
});

test("GitHub reconciler never enables destructive asset clobbering", async () => {
  const source = await readFile(
    new URL("./reconcile-github-release.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /--clobber/);
  assert.ok(
    source.indexOf("await downloadAssetIdentities") <
      source.indexOf("const plan = planReleaseAssetReconciliation"),
  );
});
