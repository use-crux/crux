import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { parseAndVerifyEvalBaselineV3 } from "../../src/eval/internal/baseline-schema";
import { BASELINE_FINGERPRINT_EPOCH } from "../../src/eval/internal/evidence/cache-epochs";

/** Register Baseline epoch migration and aligned-outcome validation behavior. */
export function baselineEpochCompatibilityBehavior(): void {
  describe("Baseline outcome epoch compatibility", () => {
    it("rejects the previous epoch with an actionable repromotion diagnostic", async () => {
      const current = await golden();
      expect(BASELINE_FINGERPRINT_EPOCH).toBe(5);
      expect(() =>
        parseAndVerifyEvalBaselineV3({
          ...current,
          baselineFingerprintEpoch: 4,
        }),
      ).toThrow(
        /fingerprint epoch 4 is incompatible; repromote with the current Crux version \(expected epoch 5\)/i,
      );
    });

    it.each([
      {
        name: "missing outcomes",
        update: (entry: Record<string, unknown>) => ({
          ...entry,
          outcomes: undefined,
        }),
        error: /outcomes/i,
      },
      {
        name: "misaligned outcomes",
        update: (entry: Record<string, unknown>) => ({
          ...entry,
          outcomes: [{ trial: 1, status: "passed" }],
        }),
        error: /align exactly with trials/i,
      },
      {
        name: "unknown outcome",
        update: (entry: Record<string, unknown>) => ({
          ...entry,
          outcomes: [{ trial: 0, status: "errored" }],
        }),
        error: /passed.*failed.*timed_out/is,
      },
      {
        name: "fabricated timed-out metric",
        update: (entry: Record<string, unknown>) => ({
          ...entry,
          outcomes: [{ trial: 0, status: "timed_out" }],
        }),
        error: /must be null for a timed-out trial/i,
      },
    ])("rejects $name", async ({ update, error }) => {
      const current = await golden();
      const coverage = current.coverage as readonly Record<string, unknown>[];
      expect(() =>
        parseAndVerifyEvalBaselineV3({
          ...current,
          coverage: [update(coverage[0]!)],
        }),
      ).toThrow(error);
    });
  });
}

async function golden(): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(
      new URL("./fixtures/baseline-v3.golden.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
}
