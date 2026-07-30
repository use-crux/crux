import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  nativeArchiveName,
  nativeArchiveRoot,
  releaseAssetNames,
} from "./asset-names.mjs";
import {
  validateNativeArchive,
  validateVsix,
} from "./inspect-release-bundles.mjs";
import { LOCAL_PLATFORMS, localPlatform } from "./platforms.mjs";
import { readPublicReleaseAssets } from "./public-assets.mjs";

/** Opens and validates every public and internal release-asset contract. */
export async function validateReleaseAssets({ version, sourceCommit, outDir }) {
  const publicDir = join(outDir, "public");
  const internalDir = join(outDir, "internal");
  const names = releaseAssetNames(version);
  const assetNames = [names.extension, ...names.archives].sort();
  await validateExactFiles(
    publicDir,
    [...assetNames, names.checksums],
    "Release assets",
  );
  await validateExactFiles(
    internalDir,
    ["release-assets.json"],
    "Internal release assets",
  );

  const manifest = JSON.parse(
    await readFile(join(internalDir, "release-assets.json"), "utf8"),
  );
  validateManifestIdentity(manifest, { version, sourceCommit, assetNames });
  await validatePublicAssetNames(publicDir, [...assetNames, names.checksums]);

  const records = new Map(manifest.assets.map((asset) => [asset.name, asset]));
  for (const platform of LOCAL_PLATFORMS) {
    const name = nativeArchiveName(version, platform);
    const record = records.get(name);
    validateNativeRecord(record, { version, platform });
    await validateRecordedBytes(publicDir, record);
    await validateNativeArchive({
      version,
      platform,
      path: join(publicDir, name),
    });
  }

  const extension = records.get(names.extension);
  validateExtensionRecord(extension);
  await validateRecordedBytes(publicDir, extension);
  await validateVsix(version, join(publicDir, names.extension));
  return { assets: assetNames };
}

/** Opens and validates the Phase 1 one-platform tracer. */
export async function validateReleaseTracer({ version, platformId, outDir }) {
  const platform = localPlatform(platformId);
  if (!platform) throw new Error(`Unknown release platform: ${platformId}`);

  const publicDir = join(outDir, "public");
  const archive = nativeArchiveName(version, platform);
  const extension = releaseAssetNames(version).extension;
  const assets = [archive, extension].sort();
  await validateExactFiles(
    publicDir,
    [...assets, "SHA256SUMS"],
    "Release tracer assets",
  );
  await validatePublicAssetNames(publicDir, [...assets, "SHA256SUMS"]);
  await validateNativeArchive({
    version,
    platform,
    path: join(publicDir, archive),
  });
  await validateVsix(version, join(publicDir, extension));
  return { assets };
}

function validateManifestIdentity(
  manifest,
  { version, sourceCommit, assetNames },
) {
  if (manifest.schemaVersion !== 1)
    throw new Error(
      `Release manifest schema ${manifest.schemaVersion}, want 1`,
    );
  if (manifest.version !== version)
    throw new Error(
      `Release manifest version ${manifest.version}, want ${version}`,
    );
  if (manifest.sourceCommit !== sourceCommit) {
    throw new Error(
      `Release manifest source commit ${manifest.sourceCommit}, want ${sourceCommit}`,
    );
  }
  if (!Array.isArray(manifest.assets))
    throw new Error("Release manifest assets must be an array.");
  const recordedNames = manifest.assets.map((asset) => asset?.name);
  if (new Set(recordedNames).size !== recordedNames.length) {
    throw new Error("Release manifest contains duplicate asset names.");
  }
  if (!sameStrings(recordedNames.sort(), assetNames)) {
    throw new Error(
      `Release manifest assets ${JSON.stringify(recordedNames)}, want ${JSON.stringify(assetNames)}`,
    );
  }
}

function validateNativeRecord(record, { version, platform }) {
  const root = nativeArchiveRoot(version, platform);
  const paths = [platform.crux, platform.worker].map(
    (name) => `${root}/${name}`,
  );
  if (
    record?.kind !== "native" ||
    record.format !== (platform.os === "win32" ? "zip" : "tar.gz") ||
    record.root !== root ||
    record.platform?.id !== platform.id ||
    record.platform?.os !== platform.os ||
    record.platform?.cpu !== platform.cpu ||
    !sameStrings(record.containedPaths ?? [], paths)
  ) {
    throw new Error(
      `Release manifest native metadata mismatch for ${platform.id}`,
    );
  }
}

function validateExtensionRecord(record) {
  if (
    record?.kind !== "extension" ||
    record.format !== "vsix" ||
    !sameStrings(record.containedPaths ?? [], [
      "extension/package.json",
      "extension/dist/extension.js",
      "extension/readme.md",
      "extension/LICENSE.txt",
    ])
  ) {
    throw new Error("Release manifest extension metadata mismatch.");
  }
}

async function validateRecordedBytes(publicDir, record) {
  const bytes = await readFile(join(publicDir, record.name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (record.size !== bytes.byteLength)
    throw new Error(`Recorded size mismatch for ${record.name}`);
  if (record.sha256 !== sha256)
    throw new Error(`Recorded checksum mismatch for ${record.name}`);
}

async function validateExactFiles(directory, expected, label) {
  const actual = (await readdir(directory)).sort();
  const sortedExpected = [...expected].sort();
  if (!sameStrings(actual, sortedExpected)) {
    throw new Error(
      `${label} ${JSON.stringify(actual)}, want ${JSON.stringify(sortedExpected)}`,
    );
  }
}

async function validatePublicAssetNames(publicDir, expectedNames) {
  const publicAssets = await readPublicReleaseAssets(publicDir);
  if (
    !sameStrings(
      publicAssets.map(({ name }) => name).sort(),
      [...expectedNames].sort(),
    )
  ) {
    throw new Error(
      "SHA256SUMS does not cover exactly the staged release assets.",
    );
  }
}

function sameStrings(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
