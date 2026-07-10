import type { AssetInfo } from "../asset";

/** Copy only allowlisted asset facts into a new immutable projection. */
export function copyAssetInfo(asset: AssetInfo): AssetInfo {
  return {
    ...(asset.filename !== undefined
      ? { filename: asset.filename.trim() }
      : {}),
    ...(asset.size !== undefined ? { size: asset.size } : {}),
    ...(asset.sha256 !== undefined ? { sha256: asset.sha256 } : {}),
    ...(asset.width !== undefined ? { width: asset.width } : {}),
    ...(asset.height !== undefined ? { height: asset.height } : {}),
    ...(asset.durationInSeconds !== undefined
      ? { durationInSeconds: asset.durationInSeconds }
      : {}),
    ...(asset.pageCount !== undefined ? { pageCount: asset.pageCount } : {}),
  };
}
