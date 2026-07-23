/**
 * @typedef {{ name: string, sha256: string }} ReleaseAssetIdentity
 * @typedef {{
 *   releaseExists: boolean,
 *   expectedAssets: readonly ReleaseAssetIdentity[],
 *   existingAssets: readonly ReleaseAssetIdentity[],
 * }} AssetReconciliationInput
 * @typedef {{ kind: "apply", createRelease: boolean, uploadNames: string[] }
 *   | { kind: "fail", reason: "invalid-state" | "duplicate-asset" | "unexpected-asset" | "checksum-conflict", assetNames: string[] }} AssetReconciliationPlan
 */

/**
 * Plans immutable GitHub Release asset reconciliation without performing I/O.
 *
 * Existing identical bytes are retained, missing assets are uploaded, and any
 * conflicting or unexpected identity fails before release metadata is changed.
 *
 * @param {AssetReconciliationInput} input
 * @returns {AssetReconciliationPlan}
 */
export function planReleaseAssetReconciliation({
  releaseExists,
  expectedAssets,
  existingAssets,
}) {
  if (!releaseExists && existingAssets.length > 0) {
    return {
      kind: "fail",
      reason: "invalid-state",
      assetNames: names(existingAssets),
    };
  }

  const duplicates = [
    ...duplicateNames(expectedAssets),
    ...duplicateNames(existingAssets),
  ];
  if (duplicates.length > 0) {
    return {
      kind: "fail",
      reason: "duplicate-asset",
      assetNames: [...new Set(duplicates)].sort(),
    };
  }

  const expectedByName = new Map(
    expectedAssets.map((asset) => [asset.name, asset]),
  );
  const existingByName = new Map(
    existingAssets.map((asset) => [asset.name, asset]),
  );
  const unexpected = existingAssets.filter(
    ({ name }) => !expectedByName.has(name),
  );
  if (unexpected.length > 0) {
    return {
      kind: "fail",
      reason: "unexpected-asset",
      assetNames: names(unexpected),
    };
  }

  const conflicts = existingAssets.filter(
    (asset) => expectedByName.get(asset.name)?.sha256 !== asset.sha256,
  );
  if (conflicts.length > 0) {
    return {
      kind: "fail",
      reason: "checksum-conflict",
      assetNames: names(conflicts),
    };
  }

  const uploadNames = expectedAssets
    .filter(({ name }) => !existingByName.has(name))
    .map(({ name }) => name);
  return { kind: "apply", createRelease: !releaseExists, uploadNames };
}

function duplicateNames(assets) {
  return assets
    .map(({ name }) => name)
    .filter((name, index, all) => all.indexOf(name) !== index);
}

function names(assets) {
  return assets.map(({ name }) => name).sort();
}
