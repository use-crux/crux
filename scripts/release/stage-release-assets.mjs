import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { stageNativeArchive } from "./archive-assets.mjs";
import { writeChecksums, writeJson } from "./asset-records.mjs";
import { LOCAL_PLATFORMS, localPlatform } from "./platforms.mjs";
import { stageExtensionVsix } from "./vsix-asset.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const vscePath = join(repoRoot, "packages/vscode/node_modules/.bin/vsce");

/**
 * Stages the complete public GitHub Release matrix and its private diagnostic
 * manifest from already-built inputs.
 */
export async function stageReleaseAssets(input) {
  const result = await stageAssetSet(input, LOCAL_PLATFORMS);
  await writeJson(join(result.internalDir, "release-assets.json"), {
    schemaVersion: 1,
    version: input.version,
    sourceCommit: input.sourceCommit,
    assets: result.assets,
  });
  return result;
}

/**
 * Stages the Phase 1 one-platform tracer. This compatibility entry point keeps
 * the focused tracer useful while the production path requires all platforms.
 */
export async function stageReleaseTracer(input) {
  const platform = localPlatform(input.platformId);
  if (!platform)
    throw new Error(`Unknown release platform: ${input.platformId}`);
  if (platform.os === "win32")
    throw new Error("Phase 1 tracer supports tar.gz platforms only.");

  const result = await stageAssetSet(input, [platform]);
  await writeJson(join(result.internalDir, "tracer.json"), {
    version: input.version,
    sourceCommit: input.sourceCommit,
    platform: platform.id,
    assets: result.assets.map(({ name, size, sha256 }) => ({
      name,
      size,
      sha256,
    })),
  });
  return result;
}

async function stageAssetSet(input, platforms) {
  requireInput(input);
  const normalizedInput = {
    ...input,
    nativeRoot: resolve(input.nativeRoot),
    extensionDir: resolve(input.extensionDir),
    outDir: resolve(input.outDir),
  };
  assertDisjointOutput(normalizedInput);

  const publicDir = join(normalizedInput.outDir, "public");
  const internalDir = join(normalizedInput.outDir, "internal");
  await rm(normalizedInput.outDir, { recursive: true, force: true });
  await Promise.all([
    mkdir(publicDir, { recursive: true }),
    mkdir(internalDir, { recursive: true }),
  ]);

  const workspace = await mkdtemp(join(tmpdir(), "crux-release-assets-"));
  try {
    const nativeAssets = [];
    for (const platform of platforms) {
      nativeAssets.push(
        await stageNativeArchive({
          ...normalizedInput,
          platform,
          publicDir,
          workspace,
        }),
      );
    }
    const extension = await stageExtensionVsix({
      ...normalizedInput,
      publicDir,
      workspace,
      vscePath,
    });
    const assets = [...nativeAssets, extension].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    await writeChecksums(publicDir, assets);
    return { publicDir, internalDir, assets };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function requireInput(input) {
  for (const field of [
    "version",
    "sourceCommit",
    "nativeRoot",
    "extensionDir",
    "outDir",
  ]) {
    if (typeof input[field] !== "string" || input[field].trim() === "") {
      throw new TypeError(`Release staging requires a non-empty ${field}.`);
    }
  }
}

function assertDisjointOutput({ outDir, nativeRoot, extensionDir }) {
  if (pathsOverlap(outDir, nativeRoot) || pathsOverlap(outDir, extensionDir)) {
    throw new Error(
      `Release output must not overlap release inputs: ${outDir}`,
    );
  }
}

function pathsOverlap(left, right) {
  return pathContains(left, right) || pathContains(right, left);
}

function pathContains(parent, child) {
  const path = relative(parent, child);
  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
  );
}
