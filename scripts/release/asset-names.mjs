import { LOCAL_PLATFORMS } from "./platforms.mjs";

/** Returns the immutable GitHub Release filename for one native platform. */
export function nativeArchiveName(version, platform) {
  requireVersion(version);
  return `crux-${version}-${platform.id}.${platform.os === "win32" ? "zip" : "tar.gz"}`;
}

/** Returns the single top-level directory stored in one native archive. */
export function nativeArchiveRoot(version, platform) {
  requireVersion(version);
  return `crux-${version}-${platform.id}`;
}

/** Returns the complete public GitHub Release naming contract. */
export function releaseAssetNames(version) {
  requireVersion(version);
  return {
    extension: `crux-vscode-${version}.vsix`,
    archives: LOCAL_PLATFORMS.map((platform) =>
      nativeArchiveName(version, platform),
    ),
    checksums: "SHA256SUMS",
  };
}

function requireVersion(version) {
  if (
    typeof version !== "string" ||
    !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)
  ) {
    throw new TypeError(
      "Release version must be a non-empty, filesystem-safe release version.",
    );
  }
}
