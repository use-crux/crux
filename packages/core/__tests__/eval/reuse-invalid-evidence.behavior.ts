import { expect, it } from "vitest";
import { planEval } from "../../src/eval/internal/planner";
import type { EvalPlanningPorts } from "../../src/eval/internal/ports";
import {
  evalValue,
  memoryEvidenceStore,
} from "./reuse-test-harness";

/** Register conservative misses for stale or non-complete evidence records. */
export function reuseInvalidEvidenceBehavior(): void {
  it.each([
    ["corrupt", { nope: true }],
    [
      "old epoch",
      { schemaVersion: 1, taskEvidenceCacheEpoch: 11, status: "complete" },
    ],
    [
      "error",
      { schemaVersion: 1, taskEvidenceCacheEpoch: 12, status: "error" },
    ],
    [
      "partial",
      { schemaVersion: 1, taskEvidenceCacheEpoch: 12, status: "partial" },
    ],
  ])("treats a %s entry as a miss", async (_label, invalidEntry) => {
    const evidenceStore = memoryEvidenceStore();
    const ports: EvalPlanningPorts = {
      evidenceStore: {
        ...evidenceStore,
        read: async () => invalidEntry,
      },
      costEstimator: { estimate: () => ({ kind: "none" }) },
      taskIdentity: {
        describe: async () => ({
          managedTaskFingerprint: "task-v1",
          hostContractFingerprint: "host-v1",
          reusable: true,
        }),
      },
    };

    const plan = await planEval(
      evalValue(),
      { sourceKey: { relativeFile: "support.eval.ts", export: "default" } },
      ports,
    );

    expect(plan.cells[0].action).toMatchObject({
      kind: "execute",
      reason: "no_exact_evidence",
    });
  });
}
