import { defineConfig } from "vitest/config";

/**
 * Embedded Postgres startup can exceed Vitest's default 10s hook timeout when
 * the monorepo runs package tests under parallel turbo load.
 *
 * Integration files open one or more pg pools (max 4 each via
 * createPostgresTestPool) against a single shared Postgres (CI service or
 * embedded). Unbounded Vitest file workers multiply those pools past the
 * server budget (~100 connections) and surface FATAL 53300 / timeouts.
 * Two workers bounds aggregate concurrency while keeping the suite practical;
 * pool max 4 means a worst-case ~8 concurrent pool caps when both workers are
 * active, well under the CI connection budget even with short-lived extra
 * pools for setup/cleanup.
 */
export default defineConfig({
  test: {
    environment: "node",
    maxWorkers: 2,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
