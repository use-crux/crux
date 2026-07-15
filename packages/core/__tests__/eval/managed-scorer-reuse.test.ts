import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import type {
  EvalEvidenceStore,
  EvalExecutionPorts,
  EvalPlanningPorts,
} from "../../src/eval/internal/ports";
import { attachEvalTaskDescriptorForInternalUse } from "../../src/eval/internal/task";
import { readScorerEvidenceEntry } from "../../src/eval/internal/scorer-evidence";
import { scorers } from "../../src/quality/scorers";

const taskIdentity = {
  reusable: true as const,
  fingerprintMaterial: { task: "v1" },
};
const task = attachEvalTaskDescriptorForInternalUse(
  Object.assign(async () => "unused", {
    _tag: "CruxTask" as const,
    operation: "function" as const,
  }),
  {
    _tag: "CruxEvalTaskDescriptor",
    operation: "generate",
    adapterId: "ai-sdk",
    capabilities: [],
    defaults: {},
    overrideKeys: [],
    projectIdentity: () => taskIdentity,
    execute: async () => ({ output: "yes" }),
    projectOutput: (result) => result.output,
    projectResponse: () => response(),
  },
);

function response() {
  return {
    content: [],
    text: "yes",
    steps: [],
    finalStep: {
      content: [],
      text: "yes",
      finishReason: "stop",
      responseId: "response-1",
      modelId: "fake",
      warnings: [],
    },
    messages: [],
    warnings: [],
  };
}

function createHarness() {
  const entries = new Map<string, unknown>();
  const evidenceStore: EvalEvidenceStore = {
    identity: "memory",
    consistency: "read_after_write",
    read: async (key) => entries.get(key),
    write: async (entry) => void entries.set(entry.key, entry),
  };
  const taskExecute = vi.fn(async () => ({
    output: "yes",
    response: response(),
    capturedSignals: [],
    runIds: ["task-run-1"],
    metrics: { durationMs: 1 },
    observedIdentity: taskIdentity,
  }));
  const scorerExecute = vi.fn(
    async (request: { readonly scorerName: string }) => ({
      name: request.scorerName,
      score: 1,
      metadata: { rationale: "good" },
    }),
  );
  const planning: EvalPlanningPorts = {
    evidenceStore,
    externalScorerHostContractFingerprint: "judge-host-v1",
    taskIdentity: {
      describe: async () => ({
        reusable: true,
        managedTaskFingerprint: "registry-v1",
        hostContractFingerprint: "task-host-v1",
      }),
    },
  };
  const execution = (): EvalExecutionPorts => ({
    evidenceStore,
    taskHost: { execute: taskExecute },
    externalScorerHost: { execute: scorerExecute },
    clock: { now: () => 1 },
    ids: { next: () => "eval-run-1" },
    runStore: { write: async () => undefined },
  });
  return { planning, execution, taskExecute, scorerExecute };
}

function definition(rubric: string) {
  return evaluate({
    id: "support",
    task,
    cases: [{ id: "refund", input: { question: "yes" }, expected: "yes" }],
    scorers: [scorers.judge({ name: "helpful", rubric })],
  });
}

function twoJudgeDefinition(firstRubric: string) {
  return evaluate({
    id: "support",
    task,
    cases: [{ id: "refund", input: { question: "yes" }, expected: "yes" }],
    scorers: [
      scorers.judge({ name: "helpful", rubric: firstRubric }),
      scorers.judge({ name: "grounded", rubric: "Is it grounded?" }),
    ],
  });
}

const source = {
  sourceKey: { relativeFile: "support.eval.ts", export: "default" as const },
};

describe("managed external scorer evidence", () => {
  it("treats scorer evidence from an older cache epoch as a miss", () => {
    expect(
      readScorerEvidenceEntry(
        {
          schemaVersion: 1,
          scorerResultCacheEpoch: 0,
          status: "complete",
          key: "score-key",
          fingerprint: "score-key",
          score: { name: "helpful", score: 1 },
        },
        "score-key",
      ),
    ).toBeUndefined();
  });

  it("admits before task execution and reuses the exact judge result", async () => {
    const harness = createHarness();
    const firstPlan = await planEval(
      definition("Is it helpful?"),
      source,
      harness.planning,
    );
    expect(firstPlan.scorerActions[0]).toMatchObject({
      kind: "after_task_output",
      admission: "admitted",
      externalKind: "model",
      reason: "output_dependency",
    });
    const first = await executeEvalPlan(firstPlan, harness.execution());
    const secondPlan = await planEval(
      definition("Is it helpful?"),
      source,
      harness.planning,
    );
    expect(secondPlan.scorerActions[0]).toMatchObject({
      kind: "reuse",
      reason: "exact_evidence",
    });
    const second = await executeEvalPlan(secondPlan, harness.execution());

    expect(harness.taskExecute).toHaveBeenCalledOnce();
    expect(harness.scorerExecute).toHaveBeenCalledOnce();
    expect(first.cells[0].scores[0]).toMatchObject({
      reason: "managed_external_executed",
      work: { status: "executed" },
    });
    expect(second.cells[0].scores[0]).toMatchObject({
      reason: "managed_external_reused",
      work: { status: "reused", reason: "exact_evidence" },
    });
  });

  it("changes only the judge work when its rubric changes", async () => {
    const harness = createHarness();
    await executeEvalPlan(
      await planEval(definition("First rubric"), source, harness.planning),
      harness.execution(),
    );
    const changedPlan = await planEval(
      definition("Changed rubric"),
      source,
      harness.planning,
    );
    expect(changedPlan.cells[0].action.kind).toBe("reuse");
    expect(changedPlan.scorerActions[0]).toMatchObject({
      kind: "execute",
      reason: "no_exact_evidence",
    });
    await executeEvalPlan(changedPlan, harness.execution());

    expect(harness.taskExecute).toHaveBeenCalledOnce();
    expect(harness.scorerExecute).toHaveBeenCalledTimes(2);
  });

  it("keeps an unchanged managed score reusable when another contract changes", async () => {
    const harness = createHarness();
    await executeEvalPlan(
      await planEval(
        twoJudgeDefinition("First rubric"),
        source,
        harness.planning,
      ),
      harness.execution(),
    );
    const changedPlan = await planEval(
      twoJudgeDefinition("Changed rubric"),
      source,
      harness.planning,
    );

    expect(changedPlan.scorerActions).toMatchObject([
      { scorerName: "helpful", kind: "execute", reason: "no_exact_evidence" },
      { scorerName: "grounded", kind: "reuse", reason: "exact_evidence" },
    ]);
    await executeEvalPlan(changedPlan, harness.execution());
    expect(harness.taskExecute).toHaveBeenCalledOnce();
    expect(harness.scorerExecute).toHaveBeenCalledTimes(3);
  });

  it("marks the admitted scorer dependency failed without calling its host", async () => {
    const harness = createHarness();
    const plan = await planEval(
      definition("Is it helpful?"),
      source,
      harness.planning,
    );
    const run = await executeEvalPlan(plan, {
      ...harness.execution(),
      taskHost: {
        execute: async () => {
          throw new Error("provider unavailable");
        },
      },
    });

    expect(harness.scorerExecute).not.toHaveBeenCalled();
    expect(run.cells[0]).toMatchObject({
      status: "errored",
      scores: [
        {
          status: "errored",
          reason: "dependency_failed",
          name: "helpful",
        },
      ],
    });
  });
});
