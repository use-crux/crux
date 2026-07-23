/**
 * @typedef {{
 *   sourceCommit: string,
 *   isPrerelease: boolean,
 *   isDraft: boolean,
 *   assetState: "complete" | "missing" | "conflict",
 * }} NightlyReleaseState
 * @typedef {{
 *   eventName: string,
 *   createdVersion: string,
 *   sourceCommit: string,
 *   latestPublishedVersion?: string,
 *   packageNames: readonly string[],
 *   publishedVersions: Readonly<Record<string, string | undefined>>,
 *   release?: NightlyReleaseState,
 * }} NightlyPublicationInput
 * @typedef {{
 *   kind: "publish" | "repair" | "complete",
 *   version: string,
 *   sourceCommit: string,
 *   build: boolean,
 *   publishNpm: boolean,
 * } | {
 *   kind: "fail",
 *   reason: "invalid-package-set" | "partial-npm" | "npm-version-conflict" | "tag-source-conflict" | "release-metadata-conflict" | "asset-conflict" | "asset-state-unknown",
 * }} NightlyPublicationDecision
 */

/**
 * Jointly decides npm publication, immutable rebuild, and GitHub asset repair
 * for one nightly source revision.
 *
 * @param {NightlyPublicationInput} input
 * @returns {NightlyPublicationDecision}
 */
export function decideNightlyRelease(input) {
  if (
    input.packageNames.length === 0 ||
    new Set(input.packageNames).size !== input.packageNames.length
  ) {
    return { kind: "fail", reason: "invalid-package-set" };
  }

  if (
    input.eventName !== "schedule" ||
    !input.latestPublishedVersion ||
    !versionTargetsSource(input.latestPublishedVersion, input.sourceCommit)
  ) {
    return action(
      "publish",
      input.createdVersion,
      input.sourceCommit,
      true,
      true,
    );
  }

  const targetVersion = input.latestPublishedVersion;
  const conflicts = input.packageNames.filter((name) => {
    const version = input.publishedVersions[name];
    return version !== undefined && version !== targetVersion;
  });
  if (conflicts.length > 0)
    return { kind: "fail", reason: "npm-version-conflict" };

  const exactCount = input.packageNames.filter(
    (name) => input.publishedVersions[name] === targetVersion,
  ).length;
  if (exactCount !== input.packageNames.length)
    return { kind: "fail", reason: "partial-npm" };

  if (!input.release)
    return action("repair", targetVersion, input.sourceCommit, true, false);
  if (!sameCommit(input.release.sourceCommit, input.sourceCommit)) {
    return { kind: "fail", reason: "tag-source-conflict" };
  }
  if (!input.release.isPrerelease || input.release.isDraft) {
    return { kind: "fail", reason: "release-metadata-conflict" };
  }
  if (input.release.assetState === "conflict")
    return { kind: "fail", reason: "asset-conflict" };
  if (input.release.assetState === "missing") {
    return action("repair", targetVersion, input.sourceCommit, true, false);
  }
  if (input.release.assetState !== "complete")
    return { kind: "fail", reason: "asset-state-unknown" };
  return action("complete", targetVersion, input.sourceCommit, false, false);
}

function action(kind, version, sourceCommit, build, publishNpm) {
  return { kind, version, sourceCommit, build, publishNpm };
}

function versionTargetsSource(version, sourceCommit) {
  const match = version.match(/\.sha([0-9a-f]{7,64})(?:\.|$)/i);
  return Boolean(match && sameCommit(match[1], sourceCommit));
}

function sameCommit(left, right) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(normalizedRight) ||
    normalizedRight.startsWith(normalizedLeft)
  );
}
