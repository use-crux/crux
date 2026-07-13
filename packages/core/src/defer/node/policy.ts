/** Fixed V1 Node defer policy; public tuning is intentionally deferred. */
export const NODE_DEFER_POLICY = Object.freeze({
  maxDrainMs: 30_000,
  maxCallbacks: 64,
  concurrency: 4,
  maxNestingDepth: 4,
  shutdownDrainMs: 5_000,
} as const);
