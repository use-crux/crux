import { LOCAL_PLATFORMS, localPlatformPackageName } from "./platforms.mjs";

/**
 * TypeScript packages emitted by the npm release compiler/stager.
 *
 * Nightly completeness checks consume the same names so orchestration cannot
 * silently omit a package that the release pipeline publishes.
 */
export const RELEASE_TYPESCRIPT_PACKAGES = Object.freeze(
  [
    { name: "@use-crux/core", dir: "packages/core", sourceRoot: "src" },
    { name: "@use-crux/ai", dir: "packages/ai", sourceRoot: "src" },
    {
      name: "@use-crux/anthropic",
      dir: "packages/anthropic",
      sourceRoot: "src",
    },
    {
      name: "@use-crux/cloudflare",
      dir: "packages/cloudflare",
      sourceRoot: "src",
    },
    { name: "@use-crux/convex", dir: "packages/convex", sourceRoot: "src" },
    { name: "@use-crux/google", dir: "packages/google", sourceRoot: "src" },
    { name: "@use-crux/indexer", dir: "packages/indexer", sourceRoot: "src" },
    { name: "@use-crux/ingest", dir: "packages/ingest", sourceRoot: "src" },
    { name: "@use-crux/next", dir: "packages/next", sourceRoot: "src" },
    { name: "@use-crux/vercel", dir: "packages/vercel", sourceRoot: "src" },
    { name: "@use-crux/mcp", dir: "packages/mcp", sourceRoot: "src" },
    { name: "@use-crux/openai", dir: "packages/openai", sourceRoot: "src" },
    { name: "@use-crux/otel", dir: "packages/otel", sourceRoot: "src" },
    { name: "@use-crux/postgres", dir: "packages/postgres", sourceRoot: "src" },
    { name: "@use-crux/react", dir: "packages/react", sourceRoot: "src" },
    { name: "@use-crux/upstash", dir: "packages/upstash", sourceRoot: "src" },
  ].map(Object.freeze),
);

/** Returns the exact npm package set required for a complete Crux release. */
export function releaseNpmPackageNames() {
  return [
    ...RELEASE_TYPESCRIPT_PACKAGES.map(({ name }) => name),
    "@use-crux/local",
    ...LOCAL_PLATFORMS.map(localPlatformPackageName),
  ];
}
