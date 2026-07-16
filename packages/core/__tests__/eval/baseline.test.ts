import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createEvalBaselineFileStore,
  EvalBaselineFileError,
} from "../../src/eval/node";
import {
  buildEvalBaseline,
  compareEvalRunToBaseline,
} from "../../src/eval/internal/baseline";
import { evaluateBlockingGates } from "../../src/eval/internal/gates";
import { runFixture } from "./baseline-test-harness";

describe("Eval Baseline V3", () => {
  it("promotes Current without raw evidence and compares a changed task", () => {
    const promoted = runFixture({ score: 0.8, taskFingerprint: "model-a" });
    const baseline = buildEvalBaseline(promoted, {
      baselineId: "baseline-1",
      promotedAt: 1_000,
      promotedBy: "Ada",
      toolVersion: "0.5.0",
    });

    expect(JSON.stringify(baseline)).not.toContain("private question");
    expect(JSON.stringify(baseline)).not.toContain("private answer");
    expect(baseline).toMatchObject({
      schemaVersion: 3,
      baselineFingerprintEpoch: 2,
      evalId: "support",
      runId: "run-1",
      selectedArm: "current",
      coverage: [
        {
          caseId: "refund",
          trials: [0],
          metrics: {
            helpful: {
              contractFingerprint: "helpful-v1",
              aggregation: "arithmetic_mean_non_null_v1",
            },
          },
        },
      ],
    });

    const later = runFixture({
      score: 0.6,
      taskFingerprint: "model-b",
      definitionFingerprint: "definition-with-new-gate",
      includeCandidate: true,
    });
    const comparison = compareEvalRunToBaseline(later, baseline);
    expect(comparison).toMatchObject({
      baselineId: "baseline-1",
      baselineRunId: "run-1",
      selectedArm: "current",
      cases: [
        {
          caseId: "refund",
          status: "compatible",
          metrics: [
            {
              name: "helpful",
              status: "compatible",
              baseline: 0.8,
              candidate: 0.6,
              delta: expect.closeTo(-0.2),
            },
          ],
        },
      ],
      unmatchedCases: { baselineOnly: [], candidateOnly: [] },
    });
    expect(
      evaluateBlockingGates(
        later.cells,
        ["current"],
        { scores: { helpful: { minDeltaVsBaseline: -0.1 } } },
        comparison,
      ),
    ).toMatchObject({
      passed: false,
      results: [
        {
          gate: "scores.helpful.minDeltaVsBaseline",
          variantName: "current",
          actual: expect.closeTo(-0.2),
          passed: false,
        },
      ],
    });
  });

  it("atomically stores the sibling Baseline and rejects stale/corrupt truth", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-baseline-"));
    const store = createEvalBaselineFileStore({ projectRoot });
    const baseline = buildEvalBaseline(runFixture({ score: 0.8 }), {
      baselineId: "baseline-1",
      promotedAt: 1_000,
      toolVersion: "0.5.0",
    });

    await expect(store.write(baseline)).resolves.toBe(
      join(projectRoot, "evals", "support.baseline.json"),
    );
    await expect(store.read(baseline.sourceKey)).resolves.toEqual(baseline);

    await mkdir(join(projectRoot, "legacy"), { recursive: true });
    await writeFile(
      join(projectRoot, "legacy", "old.baseline.json"),
      JSON.stringify({ ...baseline, baselineFingerprintEpoch: 1 }),
    );
    await expect(
      store.read({ relativeFile: "legacy/old.eval.ts", export: "default" }),
    ).rejects.toBeInstanceOf(EvalBaselineFileError);

    await writeFile(
      join(projectRoot, "evals", "support.baseline.json"),
      '{"schemaVersion":3',
    );
    await expect(store.read(baseline.sourceKey)).rejects.toThrow(
      /support\.baseline\.json.*baseline set/s,
    );
  });

  it("reads the shared future-additive Baseline golden", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-baseline-golden-"));
    const directory = join(projectRoot, "evals");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "support.baseline.json"),
      await readFile(
        new URL("./fixtures/baseline-v3.golden.json", import.meta.url),
        "utf8",
      ),
    );

    await expect(
      createEvalBaselineFileStore({ projectRoot }).read({
        relativeFile: "evals/support.eval.ts",
      }),
    ).resolves.toMatchObject({ futureBaselineField: { preserve: true } });
  });
});
