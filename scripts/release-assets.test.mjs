import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  createStagedTracerFixture,
  createTracerFixture,
  RELEASE_FIXTURE_VERSION,
  stageTracerFixture,
  validateTracerFixture,
} from "./release-assets-test-fixtures.mjs";
import {
  rewriteTracerChecksums,
  run,
} from "./release-assets-test-mutations.mjs";
import { releaseAssetNames } from "./release/asset-names.mjs";
import { LOCAL_PLATFORMS } from "./release/platforms.mjs";

const VERSION = RELEASE_FIXTURE_VERSION;

test("platform manifest pins every supported native bundle", () => {
  assert.deepEqual(
    LOCAL_PLATFORMS.map(({ id, os, cpu, crux, worker }) => ({
      id,
      os,
      cpu,
      crux,
      worker,
    })),
    [
      {
        id: "linux-x64",
        os: "linux",
        cpu: "x64",
        crux: "crux",
        worker: "crux-static-index-worker",
      },
      {
        id: "linux-arm64",
        os: "linux",
        cpu: "arm64",
        crux: "crux",
        worker: "crux-static-index-worker",
      },
      {
        id: "darwin-x64",
        os: "darwin",
        cpu: "x64",
        crux: "crux",
        worker: "crux-static-index-worker",
      },
      {
        id: "darwin-arm64",
        os: "darwin",
        cpu: "arm64",
        crux: "crux",
        worker: "crux-static-index-worker",
      },
      {
        id: "win32-x64",
        os: "win32",
        cpu: "x64",
        crux: "crux.exe",
        worker: "crux-static-index-worker.exe",
      },
      {
        id: "win32-arm64",
        os: "win32",
        cpu: "arm64",
        crux: "crux.exe",
        worker: "crux-static-index-worker.exe",
      },
    ],
  );
});

test("asset names are lockstep and platform appropriate", () => {
  assert.deepEqual(releaseAssetNames(VERSION), {
    extension: `crux-vscode-${VERSION}.vsix`,
    archives: [
      `crux-${VERSION}-linux-x64.tar.gz`,
      `crux-${VERSION}-linux-arm64.tar.gz`,
      `crux-${VERSION}-darwin-x64.tar.gz`,
      `crux-${VERSION}-darwin-arm64.tar.gz`,
      `crux-${VERSION}-win32-x64.zip`,
      `crux-${VERSION}-win32-arm64.zip`,
    ],
    checksums: "SHA256SUMS",
  });
});

test("asset names reject path-like release versions", () => {
  assert.throws(
    () => releaseAssetNames("../escape"),
    /filesystem-safe release version/,
  );
});

test("Linux tracer stages a valid archive and temporary-version VSIX", async (t) => {
  const fixture = await createTracerFixture(t);
  const sourceManifestBefore = await readFile(
    join(fixture.extensionDir, "package.json"),
    "utf8",
  );

  await stageTracerFixture(fixture);
  const result = await validateTracerFixture(fixture);

  assert.deepEqual(result.assets, [
    `crux-${VERSION}-linux-x64.tar.gz`,
    `crux-vscode-${VERSION}.vsix`,
  ]);
  assert.equal(
    await readFile(join(fixture.extensionDir, "package.json"), "utf8"),
    sourceManifestBefore,
  );
});

test("staging rejects a native bundle missing its worker sibling", async (t) => {
  const fixture = await createTracerFixture(t);
  await rm(
    join(
      fixture.nativeRoot,
      "crux-linux-x64",
      "bin",
      "crux-static-index-worker",
    ),
  );

  await assert.rejects(
    () => stageTracerFixture(fixture),
    /Missing linux-x64 release executable\(s\): crux-static-index-worker/,
  );
});

test("staging rejects an output directory that overlaps its inputs", async (t) => {
  const fixture = await createTracerFixture(t);
  const manifestPath = join(fixture.extensionDir, "package.json");
  const manifestBefore = await readFile(manifestPath, "utf8");

  await assert.rejects(
    () =>
      stageTracerFixture({
        ...fixture,
        outDir: fixture.extensionDir,
      }),
    /Release output must not overlap release inputs/,
  );
  assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
});

test("validation rejects unexpected public assets", async (t) => {
  const fixture = await createStagedTracerFixture(t);
  await writeFile(
    join(fixture.outDir, "public", "unexpected.txt"),
    "unexpected\n",
  );
  await assert.rejects(
    () => validateTracerFixture(fixture),
    /Release tracer assets/,
  );
});

test("validation rejects checksum drift", async (t) => {
  const fixture = await createStagedTracerFixture(t);
  const archive = join(
    fixture.outDir,
    "public",
    `crux-${VERSION}-linux-x64.tar.gz`,
  );
  await writeFile(archive, "tampered\n", { flag: "a" });
  await assert.rejects(
    () => validateTracerFixture(fixture),
    /Checksum mismatch/,
  );
});

test("validation rejects non-executable Unix archive entries", async (t) => {
  const fixture = await createStagedTracerFixture(t);
  const archive = join(
    fixture.outDir,
    "public",
    `crux-${VERSION}-linux-x64.tar.gz`,
  );
  const extracted = await mkdirAndReturn(join(fixture.root, "extracted"));
  run("tar", ["-xzf", archive, "-C", extracted]);
  await chmod(
    join(extracted, `crux-${VERSION}-linux-x64`, "crux-static-index-worker"),
    0o644,
  );
  await rm(archive);
  run("tar", ["-czf", archive, "-C", extracted, `crux-${VERSION}-linux-x64`]);
  await rewriteTracerChecksums(fixture.outDir);
  await assert.rejects(
    () => validateTracerFixture(fixture),
    /Archive executable is not executable/,
  );
});

test("validation rejects a VSIX manifest version mismatch", async (t) => {
  const fixture = await createStagedTracerFixture(t);
  const vsix = join(fixture.outDir, "public", `crux-vscode-${VERSION}.vsix`);
  const extracted = await mkdirAndReturn(join(fixture.root, "vsix"));
  run("unzip", ["-q", vsix, "-d", extracted]);
  const manifestPath = join(extracted, "extension", "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = "9.9.9";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await rm(vsix);
  run("zip", ["-X", "-q", "-r", vsix, "."], { cwd: extracted });
  await rewriteTracerChecksums(fixture.outDir);
  await assert.rejects(
    () => validateTracerFixture(fixture),
    /VSIX version 9.9.9/,
  );
});

test("validation rejects archive paths outside the release root", async (t) => {
  const fixture = await createStagedTracerFixture(t);
  const archive = join(
    fixture.outDir,
    "public",
    `crux-${VERSION}-linux-x64.tar.gz`,
  );
  const malicious = await mkdirAndReturn(join(fixture.root, "malicious"));
  await writeFile(join(malicious, "payload"), "escape\n");
  await rm(archive);
  run("tar", [
    "-czf",
    archive,
    "--transform=s|payload|../escape|",
    "-C",
    malicious,
    "payload",
  ]);
  await rewriteTracerChecksums(fixture.outDir);
  await assert.rejects(
    () => validateTracerFixture(fixture),
    /Archive entry escapes/,
  );
});

async function mkdirAndReturn(path) {
  await mkdir(path, { recursive: true });
  return path;
}
