import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LOCAL_PLATFORMS } from "./release/platforms.mjs";
import { stageReleaseTracer } from "./release/stage-release-assets.mjs";
import { validateReleaseTracer } from "./release/validate-release-assets.mjs";

export const RELEASE_FIXTURE_VERSION = "1.2.3-nightly.20260723.shaabcdef0";
export const RELEASE_FIXTURE_COMMIT = "abcdef0123456789";

/** Creates a disposable Linux-only release tracer fixture. */
export async function createTracerFixture(t) {
  const root = await createFixtureRoot(t, "crux-release-tracer-");
  const nativeRoot = join(root, "native");
  const nativeBin = join(nativeRoot, "crux-linux-x64", "bin");
  await mkdir(nativeBin, { recursive: true });
  for (const executable of ["crux", "crux-static-index-worker"]) {
    const path = join(nativeBin, executable);
    await writeFile(path, `#!/bin/sh\necho ${executable}\n`);
    await chmod(path, 0o755);
  }

  const extensionDir = await createExtensionFixture(root);
  return { root, nativeRoot, extensionDir, outDir: join(root, "stage") };
}

/** Creates and stages a disposable Linux-only tracer fixture. */
export async function createStagedTracerFixture(t) {
  const fixture = await createTracerFixture(t);
  await stageTracerFixture(fixture);
  return fixture;
}

/** Stages the standard tracer fixture through the Phase 1 compatibility API. */
export function stageTracerFixture(fixture) {
  return stageReleaseTracer({
    version: RELEASE_FIXTURE_VERSION,
    sourceCommit: RELEASE_FIXTURE_COMMIT,
    platformId: "linux-x64",
    nativeRoot: fixture.nativeRoot,
    extensionDir: fixture.extensionDir,
    outDir: fixture.outDir,
  });
}

/** Validates the standard tracer fixture through the Phase 1 compatibility API. */
export function validateTracerFixture(fixture) {
  return validateReleaseTracer({
    version: RELEASE_FIXTURE_VERSION,
    platformId: "linux-x64",
    outDir: fixture.outDir,
  });
}

/** Creates disposable native inputs for every supported release platform. */
export async function createMatrixFixture(t) {
  const root = await createFixtureRoot(t, "crux-release-matrix-");
  const nativeRoot = join(root, "native");
  for (const platform of LOCAL_PLATFORMS) {
    const bin = join(nativeRoot, `crux-${platform.id}`, "bin");
    await mkdir(bin, { recursive: true });
    for (const executable of [platform.crux, platform.worker]) {
      const path = join(bin, executable);
      await writeFile(path, `fixture ${platform.id} ${executable}\n`);
      if (platform.os !== "win32") await chmod(path, 0o755);
    }
  }

  const extensionDir = await createExtensionFixture(root);
  return { root, nativeRoot, extensionDir };
}

async function createFixtureRoot(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function createExtensionFixture(root) {
  const extensionDir = join(root, "extension");
  await mkdir(join(extensionDir, "dist"), { recursive: true });
  await writeFile(
    join(extensionDir, "package.json"),
    `${JSON.stringify(
      {
        name: "crux-vscode",
        version: "0.1.0",
        private: true,
        displayName: "Crux",
        description: "Crux language support",
        publisher: "use-crux",
        license: "Apache-2.0",
        repository: {
          type: "git",
          url: "https://github.com/use-crux/crux.git",
          directory: "packages/vscode",
        },
        bugs: { url: "https://github.com/use-crux/crux/issues" },
        homepage: "https://cruxjs.dev/docs/reference/lsp",
        engines: { vscode: "^1.90.0" },
        activationEvents: ["onLanguage:typescript"],
        files: ["dist/extension.js", "README.md", "LICENSE"],
        main: "./dist/extension.js",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(extensionDir, "README.md"),
    [
      "# Crux",
      "https://github.com/use-crux/crux/releases",
      "https://github.com/use-crux/crux/issues",
      "https://cruxjs.dev/docs/reference/lsp",
      "",
    ].join("\n"),
  );
  await writeFile(join(extensionDir, "LICENSE"), "Apache-2.0\n");
  await writeFile(
    join(extensionDir, "dist/extension.js"),
    "exports.activate = () => {}\n",
  );
  return extensionDir;
}
