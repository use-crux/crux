import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, utimes } from "node:fs/promises";
import { dirname, join } from "node:path";

import { nativeArchiveName, nativeArchiveRoot } from "./asset-names.mjs";
import { assetRecord } from "./asset-records.mjs";

const ZIP_EPOCH_SECONDS = Date.UTC(1980, 0, 1) / 1000;

/**
 * Stages one deterministic native release archive from an already-built
 * platform bundle.
 */
export async function stageNativeArchive({
  version,
  platform,
  nativeRoot,
  publicDir,
  workspace,
}) {
  const sourceBin = join(nativeRoot, `crux-${platform.id}`, "bin");
  const executables = [platform.crux, platform.worker];
  const missing = executables.filter(
    (name) => !existsSync(join(sourceBin, name)),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing ${platform.id} release executable(s): ${missing.join(", ")}`,
    );
  }

  const rootName = nativeArchiveRoot(version, platform);
  const archiveRoot = join(workspace, "archives", platform.id, rootName);
  await mkdir(archiveRoot, { recursive: true });
  for (const executable of executables) {
    const destination = join(archiveRoot, executable);
    await cp(join(sourceBin, executable), destination);
    if (platform.os !== "win32") await chmod(destination, 0o755);
    await utimes(destination, ZIP_EPOCH_SECONDS, ZIP_EPOCH_SECONDS);
  }
  await utimes(archiveRoot, ZIP_EPOCH_SECONDS, ZIP_EPOCH_SECONDS);

  const name = nativeArchiveName(version, platform);
  const path = join(publicDir, name);
  if (platform.os === "win32") {
    createZip(path, dirname(archiveRoot), rootName, executables);
  } else {
    createTarGzip(path, dirname(archiveRoot), rootName);
  }

  return {
    ...(await assetRecord(path, name)),
    kind: "native",
    platform: { id: platform.id, os: platform.os, cpu: platform.cpu },
    format: platform.os === "win32" ? "zip" : "tar.gz",
    root: rootName,
    containedPaths: executables.map(
      (executable) => `${rootName}/${executable}`,
    ),
  };
}

function createTarGzip(path, cwd, rootName) {
  run(
    "tar",
    [
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "-czf",
      path,
      "-C",
      cwd,
      rootName,
    ],
    { env: { ...process.env, GZIP: "-n" } },
  );
}

function createZip(path, cwd, rootName, executables) {
  run(
    "zip",
    ["-X", "-q", path, ...executables.map((name) => `${rootName}/${name}`)],
    { cwd },
  );
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status ?? "signal"}): ${result.stderr || result.stdout}`,
    );
  }
}
