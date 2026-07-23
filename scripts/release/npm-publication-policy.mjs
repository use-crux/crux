/**
 * @typedef {{ name: string, version: string }} StagedPackageIdentity
 * @typedef {{
 *   releaseVersion: string,
 *   packages: readonly StagedPackageIdentity[],
 *   publishedVersions: Readonly<Record<string, string | undefined>>,
 * }} StableNpmPublicationInput
 * @typedef {{
 *   kind: "publish" | "assets-only" | "fail",
 *   packageNames: string[],
 *   reason?: "empty-staged-set" | "duplicate-staged-package" | "staged-version-mismatch" | "registry-version-mismatch" | "partial",
 * }} StableNpmPublicationDecision
 */

/**
 * Decides the stable npm action before publication begins.
 *
 * A stable release may publish only when none of the staged identities exist.
 * An exact complete set may skip npm and repair GitHub assets. Every mixed or
 * mismatched state fails closed so a rerun cannot deepen a partial release.
 *
 * @param {StableNpmPublicationInput} input
 * @returns {StableNpmPublicationDecision}
 */
export function decideStableNpmPublication({
  releaseVersion,
  packages,
  publishedVersions,
}) {
  if (packages.length === 0) {
    return { kind: "fail", reason: "empty-staged-set", packageNames: [] };
  }

  const names = packages.map(({ name }) => name);
  const duplicates = names.filter(
    (name, index) => names.indexOf(name) !== index,
  );
  if (duplicates.length > 0) {
    return {
      kind: "fail",
      reason: "duplicate-staged-package",
      packageNames: [...new Set(duplicates)].sort(),
    };
  }

  const stagedMismatches = packages
    .filter(({ version }) => version !== releaseVersion)
    .map(({ name }) => name)
    .sort();
  if (stagedMismatches.length > 0) {
    return {
      kind: "fail",
      reason: "staged-version-mismatch",
      packageNames: stagedMismatches,
    };
  }

  const registryMismatches = packages
    .filter(({ name }) => {
      const published = publishedVersions[name];
      return published !== undefined && published !== releaseVersion;
    })
    .map(({ name }) => name)
    .sort();
  if (registryMismatches.length > 0) {
    return {
      kind: "fail",
      reason: "registry-version-mismatch",
      packageNames: registryMismatches,
    };
  }

  const published = packages.filter(
    ({ name }) => publishedVersions[name] === releaseVersion,
  );
  if (published.length === 0) {
    return { kind: "publish", packageNames: [...names] };
  }
  if (published.length === packages.length) {
    return { kind: "assets-only", packageNames: [] };
  }
  return { kind: "fail", reason: "partial", packageNames: [...names] };
}
