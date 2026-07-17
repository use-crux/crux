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
 */
const BASELINE_INSTANTIATIONS = 424_761;

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
