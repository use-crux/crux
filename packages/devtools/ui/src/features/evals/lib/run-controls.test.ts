import { describe, expect, it } from "vitest";
import type { EvalRunRecord } from "../types";
import { baselineArmForRun, comparableEvalRuns } from "./run-controls";

const run = (
  runId: string,
  evalId: string,
  variants: readonly string[] = ["current"],
): EvalRunRecord => ({
  schemaVersion: 3,
  runId,
  evalId,
  sourceKey: { relativeFile: `${evalId}.eval.ts`, export: "default" },
  definitionFingerprint: `${evalId}-definition`,
  status: "complete",
  passed: true,
  startedAt: 1,
  endedAt: 2,
  selection: {},
  cells: [],
  variants: variants.map((name) => ({
    name,
    fingerprint: `${name}-fingerprint`,
    overrideKeys: [],
    blocking: true,
  })),
});

describe("Eval run controls", () => {
  it("only offers runs from the selected Eval for comparison", () => {
    const selected = run("support-new", "support");
    expect(
      comparableEvalRuns(selected, [
        selected,
        run("refund-old", "refund"),
        run("support-old", "support"),
      ]).map((candidate) => candidate.runId),
    ).toEqual(["support-old"]);
  });

  it("rejects a Baseline arm that does not belong to the selected run", () => {
    const selected = run("support-new", "support", ["current", "cheap"]);
    expect(baselineArmForRun(selected, "refund-specific")).toBe("current");
    expect(baselineArmForRun(selected, "cheap")).toBe("cheap");
  });
});
