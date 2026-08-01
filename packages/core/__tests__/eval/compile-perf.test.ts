import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Compile-performance budget for 50 representative Eval definitions.
 *
 * The baseline is measured with TypeScript 5.9.3. Public type changes must stay
 * within +20%; a large drop means the fixture stopped exercising inference.
 * Re-recorded twice on 2026-07-31 for deliberate public surface growth —
 * whole-request context planning (representation ladders, preparation
 * amendments, receipts) and connected knowledge (views, relations,
 * assertions, communities) — then measured on the merged tree, where the
 * combined surfaces instantiate more than either branch alone.
 */
const BASELINE_INSTANTIATIONS = 581_481;

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..", "..");
const require = createRequire(import.meta.url);

describe("Eval authoring compile-performance budget", () => {
  it(
    "keeps 50 Eval definitions within +20% of the recorded baseline",
    { timeout: 180_000 },
    () => {
      const tscPath = require.resolve("typescript/lib/tsc.js");
      const output = execFileSync(
        process.execPath,
        [
          tscPath,
          "-p",
          resolve(here, "tsconfig.perf.json"),
          "--noEmit",
          "--extendedDiagnostics",
        ],
        { cwd: packageRoot, encoding: "utf8" },
      );
      const match = output.match(/^Instantiations:\s+([\d,]+)/mu);
      expect(
        match,
        `tsc output missing extendedDiagnostics:\n${output}`,
      ).not.toBeNull();

      const instantiations = Number(match?.[1]?.replaceAll(",", ""));
      expect(instantiations).toBeGreaterThanOrEqual(
        Math.round(BASELINE_INSTANTIATIONS * 0.5),
      );
      expect(instantiations).toBeLessThanOrEqual(
        Math.round(BASELINE_INSTANTIATIONS * 1.2),
      );
    },
  );
});
