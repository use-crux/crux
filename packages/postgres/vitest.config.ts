import { defineConfig } from "vitest/config";

/**
 * Embedded Postgres startup can exceed Vitest's default 10s hook budget when
 * the monorepo runs package tests under parallel turbo load.
 */
export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
