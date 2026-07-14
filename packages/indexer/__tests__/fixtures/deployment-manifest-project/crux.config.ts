/** Enables the production Rust/Oxc Static Index lane for CLI parity fixtures. */
export default {
  experimental: {
    indexer: {
      nativeAst: true,
    },
  },
}
