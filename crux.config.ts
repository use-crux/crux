import { config } from "@use-crux/core";

/**
 * Local monorepo config for Project Index native static AST verification.
 *
 * Enables experimental Oxc/nativeAst so `crux index reindex` works without the
 * removed TypeScript bundled AST fallback. Not required for package consumers.
 */
export default config({
  experimental: {
    indexer: {
      nativeAst: true as const,
    },
  },
});
