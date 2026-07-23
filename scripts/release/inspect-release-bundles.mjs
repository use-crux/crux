import { spawnSync } from "node:child_process";
import { access, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, normalize, sep } from "node:path";

import { nativeArchiveRoot } from "./asset-names.mjs";

/** Opens one native bundle and validates its exact paths, types, and modes. */
export async function validateNativeArchive({ version, platform, path }) {
  const root = nativeArchiveRoot(version, platform);
  const files = [platform.crux, platform.worker].map(
    (name) => `${root}/${name}`,
  );
  const listing = archiveListing(path, platform).map((entry) =>
    entry.replace(/^\.\//, ""),
  );
  for (const entry of listing) assertSafeArchiveEntry(entry, root);

  const expectedEntries =
    platform.os === "win32" ? files : [`${root}/`, ...files];
  if (!sameStrings([...listing].sort(), [...expectedEntries].sort())) {
    throw new Error(
      `Archive entries ${JSON.stringify(listing)}, want ${JSON.stringify(expectedEntries)}`,
    );
  }

  const extracted = await mkdtemp(join(tmpdir(), "crux-release-validate-"));
  try {
    extractArchive(path, platform, extracted);
    for (const executable of [platform.crux, platform.worker]) {
      const executablePath = join(extracted, root, executable);
      await access(executablePath);
      const info = await lstat(executablePath);
      if (!info.isFile())
        throw new Error(
          `Archive executable is not a regular file: ${executable}`,
        );
      if (platform.os !== "win32" && (info.mode & 0o111) === 0) {
        throw new Error(`Archive executable is not executable: ${executable}`);
      }
    }
  } finally {
    await rm(extracted, { recursive: true, force: true });
  }
}

/** Opens a VSIX and verifies its lockstep version and built entry point. */
export async function validateVsix(version, path) {
  const listing = run("unzip", ["-Z1", path]).trim().split("\n");
  for (const required of [
    "extension/package.json",
    "extension/dist/extension.js",
    "extension/readme.md",
    "extension/LICENSE.txt",
  ]) {
    if (!listing.includes(required))
      throw new Error(`VSIX is missing ${required}: ${basename(path)}`);
  }
  const manifest = JSON.parse(
    run("unzip", ["-p", path, "extension/package.json"]),
  );
  if (manifest.version !== version)
    throw new Error(`VSIX version ${manifest.version}, want ${version}`);
  if (
    manifest.private !== undefined ||
    manifest.license !== "Apache-2.0" ||
    manifest.repository?.url !== "https://github.com/use-crux/crux.git" ||
    manifest.bugs?.url !== "https://github.com/use-crux/crux/issues" ||
    manifest.homepage !== "https://cruxjs.dev/docs/reference/lsp"
  ) {
    throw new Error(`VSIX public metadata is incomplete: ${basename(path)}`);
  }
  const readme = run("unzip", ["-p", path, "extension/readme.md"]);
  for (const href of [
    "https://github.com/use-crux/crux/releases",
    "https://github.com/use-crux/crux/issues",
    "https://cruxjs.dev/docs/reference/lsp",
  ]) {
    if (!readme.includes(href))
      throw new Error(`VSIX README is missing ${href}: ${basename(path)}`);
  }
}

function archiveListing(path, platform) {
  const output =
    platform.os === "win32"
      ? run("unzip", ["-Z1", path])
      : run("tar", ["-tzf", path]);
  return output.trim().split("\n").filter(Boolean);
}

function extractArchive(path, platform, destination) {
  if (platform.os === "win32") run("unzip", ["-q", path, "-d", destination]);
  else run("tar", ["-xzf", path, "--no-same-owner", "-C", destination]);
}

function assertSafeArchiveEntry(entry, root) {
  const unixEntry = entry.replaceAll("\\", "/");
  const normalized = normalize(unixEntry).split(sep).join("/");
  if (
    unixEntry.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    (normalized !== root && !normalized.startsWith(`${root}/`))
  ) {
    throw new Error(`Archive entry escapes ${root}: ${entry}`);
  }
}

function sameStrings(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status ?? "signal"}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}
