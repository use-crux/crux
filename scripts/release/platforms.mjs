/**
 * Native bundles published for Crux Local.
 *
 * npm staging and GitHub Release packaging consume this manifest so platform
 * identity and executable names cannot drift between distribution surfaces.
 */
export const LOCAL_PLATFORMS = Object.freeze([
  platform("linux-x64", "linux", "x64"),
  platform("linux-arm64", "linux", "arm64"),
  platform("darwin-x64", "darwin", "x64"),
  platform("darwin-arm64", "darwin", "arm64"),
  platform("win32-x64", "win32", "x64"),
  platform("win32-arm64", "win32", "arm64"),
]);

/** Returns the platform manifest row for a stable platform id. */
export function localPlatform(platformId) {
  return LOCAL_PLATFORMS.find(({ id }) => id === platformId);
}

/** Returns the published npm package name for a platform bundle. */
export function localPlatformPackageName(platform) {
  return `@use-crux/local-${platform.id}`;
}

/** Returns the binary paths required in a staged npm platform package. */
export function localPlatformPackageBinaries(platform) {
  return [`bin/${platform.crux}`, `bin/${platform.worker}`];
}

function platform(id, os, cpu) {
  const windows = os === "win32";
  return Object.freeze({
    id,
    os,
    cpu,
    crux: windows ? "crux.exe" : "crux",
    worker: windows
      ? "crux-static-index-worker.exe"
      : "crux-static-index-worker",
  });
}
