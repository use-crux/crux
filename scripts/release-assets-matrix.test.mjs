import assert from "node:assert/strict";
import { cp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  createMatrixFixture,
  RELEASE_FIXTURE_COMMIT,
  RELEASE_FIXTURE_VERSION,
} from "./release-assets-test-fixtures.mjs";
import {
  directoryDigests,
  duplicateFirstChecksum,
  mutateManifest,
  rewriteWindowsArchive,
  runReleaseScript,
} from "./release-assets-test-mutations.mjs";
import { releaseAssetNames } from "./release/asset-names.mjs";
import { stageReleaseAssets } from "./release/stage-release-assets.mjs";
import { validateReleaseAssets } from "./release/validate-release-assets.mjs";

const VERSION = RELEASE_FIXTURE_VERSION;
const SOURCE_COMMIT = RELEASE_FIXTURE_COMMIT;
const STABLE_VERSION = "1.2.3";

test("complete release matrix is exact, valid, and byte-reproducible", async (t) => {
  const fixture = await createMatrixFixture(t);
  const firstOut = join(fixture.root, "first");
  const secondOut = join(fixture.root, "second");

  runReleaseScript("stage-github-release-assets.mjs", [
    "--version",
    VERSION,
    "--source-commit",
    SOURCE_COMMIT,
    "--native-root",
    fixture.nativeRoot,
    "--extension-dir",
    fixture.extensionDir,
    "--out",
    firstOut,
  ]);
  runReleaseScript("validate-github-release-assets.mjs", [
    "--version",
    VERSION,
    "--source-commit",
    SOURCE_COMMIT,
    "--out",
    firstOut,
  ]);

  await stageReleaseAssets({
    version: VERSION,
    sourceCommit: SOURCE_COMMIT,
    nativeRoot: fixture.nativeRoot,
    extensionDir: fixture.extensionDir,
    outDir: secondOut,
  });
  await validateReleaseAssets({
    version: VERSION,
    sourceCommit: SOURCE_COMMIT,
    outDir: secondOut,
  });

  const names = releaseAssetNames(VERSION);
  const expectedPublic = [
    names.extension,
    ...names.archives,
    names.checksums,
  ].sort();
  assert.deepEqual(
    (await readdir(join(firstOut, "public"))).sort(),
    expectedPublic,
  );
  assert.deepEqual(await readdir(join(firstOut, "internal")), [
    "release-assets.json",
  ]);
  assert.deepEqual(
    await directoryDigests(join(firstOut, "public")),
    await directoryDigests(join(secondOut, "public")),
  );
});

test("stable and nightly staging emit the same public matrix shape", async (t) => {
  const fixture = await createMatrixFixture(t);
  const shapes = [];
  for (const version of [STABLE_VERSION, VERSION]) {
    const outDir = join(fixture.root, version);
    await stageReleaseAssets({
      version,
      sourceCommit: SOURCE_COMMIT,
      nativeRoot: fixture.nativeRoot,
      extensionDir: fixture.extensionDir,
      outDir,
    });
    await validateReleaseAssets({ version, sourceCommit: SOURCE_COMMIT, outDir });
    shapes.push(
      (await readdir(join(outDir, "public")))
        .sort()
        .map((name) => name.replaceAll(version, "<version>")),
    );
  }
  assert.deepEqual(shapes[0], shapes[1]);
});

test("validator rejects matrix identity and archive drift", async (t) => {
  const fixture = await createMatrixFixture(t);
  const baseline = join(fixture.root, "baseline");
  await stageReleaseAssets({
    version: VERSION,
    sourceCommit: SOURCE_COMMIT,
    nativeRoot: fixture.nativeRoot,
    extensionDir: fixture.extensionDir,
    outDir: baseline,
  });

  const names = releaseAssetNames(VERSION);
  const firstArchive = names.archives[0];
  const cases = [
    {
      name: "missing public asset",
      mutate: (outDir) => rm(join(outDir, "public", firstArchive)),
      error: /Release assets/,
    },
    {
      name: "unexpected public asset",
      mutate: (outDir) =>
        writeFile(join(outDir, "public", "unexpected.txt"), "unexpected\n"),
      error: /Release assets/,
    },
    {
      name: "wrong public asset name",
      mutate: (outDir) =>
        rename(
          join(outDir, "public", firstArchive),
          join(outDir, "public", "wrong-name.tar.gz"),
        ),
      error: /Release assets/,
    },
    {
      name: "duplicate checksum identity",
      mutate: duplicateFirstChecksum,
      error: /SHA256SUMS does not cover exactly/,
    },
    {
      name: "duplicate manifest identity",
      mutate: (outDir) =>
        mutateManifest(outDir, (manifest) =>
          manifest.assets.push(manifest.assets[0]),
        ),
      error: /duplicate asset names/,
    },
    {
      name: "source commit mismatch",
      mutate: (outDir) =>
        mutateManifest(
          outDir,
          (manifest) => (manifest.sourceCommit = "different"),
        ),
      error: /source commit/,
    },
    {
      name: "manifest version mismatch",
      mutate: (outDir) =>
        mutateManifest(outDir, (manifest) => (manifest.version = "9.9.9")),
      error: /manifest version/,
    },
    {
      name: "recorded size mismatch",
      mutate: (outDir) =>
        mutateManifest(outDir, (manifest) => (manifest.assets[0].size += 1)),
      error: /Recorded size mismatch/,
    },
    {
      name: "recorded checksum mismatch",
      mutate: (outDir) =>
        mutateManifest(
          outDir,
          (manifest) => (manifest.assets[0].sha256 = "0".repeat(64)),
        ),
      error: /Recorded checksum mismatch/,
    },
    {
      name: "platform archive missing worker",
      mutate: (outDir) => rewriteWindowsArchive(outDir, VERSION, ["crux.exe"]),
      error: /Archive entries/,
    },
    {
      name: "platform archive uses wrong executable name",
      mutate: (outDir) =>
        rewriteWindowsArchive(outDir, VERSION, [
          "crux.exe",
          "wrong-worker.exe",
        ]),
      error: /Archive entries/,
    },
  ];

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async () => {
      const outDir = join(fixture.root, fixtureCase.name.replaceAll(" ", "-"));
      await cp(baseline, outDir, { recursive: true });
      await fixtureCase.mutate(outDir);
      await assert.rejects(
        () =>
          validateReleaseAssets({
            version: VERSION,
            sourceCommit: SOURCE_COMMIT,
            outDir,
          }),
        fixtureCase.error,
      );
    });
  }
});
