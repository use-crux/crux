/** Fixed V1 serverless defer policy; public tuning is intentionally deferred. */
export const SERVERLESS_DEFER_POLICY = Object.freeze({
  maxDrainMs: 30_000,
  maxCallbacks: 64,
  concurrency: 4,
  maxNestingDepth: 4,
} as const);
