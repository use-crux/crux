import { spawnSync } from "node:child_process";

/**
 * Reads the exact published version, if any, for every staged npm identity.
 * Registry errors other than an explicit not-found response fail closed.
 *
 * @param {readonly { name: string, version: string }[]} packages
 * @param {{ registry?: string, spawn?: typeof spawnSync }} [options]
 * @returns {Record<string, string | undefined>}
 */
export function readPublishedNpmVersions(packages, options = {}) {
  const versions = {};
  for (const pkg of packages) {
    versions[pkg.name] = readNpmVersion(`${pkg.name}@${pkg.version}`, options);
  }
  return versions;
}

/** Reads one npm dist-tag version, returning undefined only for an explicit 404. */
export function readNpmDistTagVersion(packageName, tag, options = {}) {
  return readNpmVersion(`${packageName}@${tag}`, options);
}

function readNpmVersion(spec, options) {
  const spawn = options.spawn ?? spawnSync;
  const args = ["view", spec, "version", "--json"];
  if (options.registry) args.push("--registry", options.registry);
  const result = spawn("npm", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status === 0) return parseNpmVersion(result.stdout);

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (output.includes("E404") || output.includes("404 Not Found"))
    return undefined;
  throw new Error(`npm view failed for ${spec}\n${output.trim()}`);
}

function parseNpmVersion(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    return trimmed;
  }
}
