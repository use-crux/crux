import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { LOCAL_PLATFORMS } from "./release/platforms.mjs";

/** Returns sorted SHA-256 identities for every direct child file. */
export async function directoryDigests(path) {
  const digests = {};
  for (const name of (await readdir(path)).sort()) {
    digests[name] = createHash("sha256")
      .update(await readFile(join(path, name)))
      .digest("hex");
  }
  return digests;
}

/** Appends a duplicate checksum row without changing public asset bytes. */
export async function duplicateFirstChecksum(outDir) {
  const path = join(outDir, "public", "SHA256SUMS");
  const contents = await readFile(path, "utf8");
  await writeFile(path, `${contents}${contents.split("\n")[0]}\n`);
}

/** Applies one focused mutation to the private release manifest. */
export async function mutateManifest(outDir, mutate) {
  const path = join(outDir, "internal", "release-assets.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  mutate(manifest);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Rebuilds the Windows x64 archive with an intentionally supplied file set. */
export async function rewriteWindowsArchive(outDir, version, executables) {
  const platform = LOCAL_PLATFORMS.find(({ id }) => id === "win32-x64");
  const rootName = `crux-${version}-${platform.id}`;
  const workspace = join(outDir, ".archive-mutation");
  await mkdir(join(workspace, rootName), { recursive: true });
  for (const executable of executables) {
    await writeFile(join(workspace, rootName, executable), `${executable}\n`);
  }

  const archiveName = `crux-${version}-${platform.id}.zip`;
  const archivePath = join(outDir, "public", archiveName);
  await rm(archivePath);
  run(
    "zip",
    [
      "-X",
      "-q",
      archivePath,
      ...executables.map((name) => `${rootName}/${name}`),
    ],
    { cwd: workspace },
  );
  await rewriteMatrixIntegrity(outDir);
}

/** Rewrites Phase 1 checksums after an intentional public-asset mutation. */
export async function rewriteTracerChecksums(outDir) {
  const publicDir = join(outDir, "public");
  const names = (await readdir(publicDir))
    .filter((name) => name !== "SHA256SUMS")
    .sort();
  const lines = [];
  for (const name of names) {
    const hash = createHash("sha256")
      .update(await readFile(join(publicDir, name)))
      .digest("hex");
    lines.push(`${hash}  ${name}`);
  }
  await writeFile(join(publicDir, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

/** Runs one repository release CLI and surfaces its full failure output. */
export function runReleaseScript(script, args) {
  run(process.execPath, [join(import.meta.dirname, script), ...args]);
}

/** Runs a deterministic fixture archive command. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
}

async function rewriteMatrixIntegrity(outDir) {
  const publicDir = join(outDir, "public");
  const assetNames = (await readdir(publicDir))
    .filter((name) => name !== "SHA256SUMS")
    .sort();
  const identities = new Map();
  for (const name of assetNames) {
    const bytes = await readFile(join(publicDir, name));
    identities.set(name, {
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await writeFile(
    join(publicDir, "SHA256SUMS"),
    `${assetNames.map((name) => `${identities.get(name).sha256}  ${name}`).join("\n")}\n`,
  );
  await mutateManifest(outDir, (manifest) => {
    for (const asset of manifest.assets)
      Object.assign(asset, identities.get(asset.name));
  });
}
