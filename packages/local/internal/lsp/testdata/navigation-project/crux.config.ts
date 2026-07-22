import { config } from "@use-crux/core";

/** Enables the production native static-index lane used by LSP navigation tests. */
export default config({
  experimental: {
    indexer: {
      nativeAst: true,
    },
  },
});
