import { config } from "@use-crux/core";

/** Enables the production native static-index lane used by the local binary. */
export default config({
  experimental: {
    indexer: {
      nativeAst: true,
    },
  },
});
