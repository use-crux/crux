import { describe, expect, it, vi } from "vitest";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import { attachEvalTaskDescriptorForInternalUse } from "../../src/eval/internal/task";
import type {
  EvalEvidenceStore,
  EvalExecutionPorts,
  EvalPlanningPorts,
} from "../../src/eval/internal/ports";
import type { Score, ScorerArgs } from "../../src/quality/scorers";

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
    projectIdentity: () => ({
      reusable: true,
      fingerprintMaterial: { adapter: "fake-v1" },
    }),
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

function harness() {
  const entries = new Map<string, unknown>();
  const evidenceStore: EvalEvidenceStore = {
    identity: "memory",
    consistency: "read_after_write",
    read: async (key) => entries.get(key),
    write: async (entry) => void entries.set(entry.key, entry),
  };
  const planning: EvalPlanningPorts = {
    evidenceStore,
    taskIdentity: {
      describe: async () => ({
        managedTaskFingerprint: "task-v1",
        hostContractFingerprint: "host-v1",
        reusable: true,
      }),
    },
  };
  const execute = vi.fn(async () => ({
    output: "yes",
    response: response(),
    capturedSignals: [],
    runIds: ["task-run-1"],
    metrics: { durationMs: 20 },
    observedIdentity: {
      reusable: true as const,
      fingerprintMaterial: { adapter: "fake-v1" },
    },
  }));
  const execution = (): EvalExecutionPorts => ({
    evidenceStore,
    taskHost: { execute },
    clock: { now: () => 1 },
    ids: { next: () => "eval-run-1" },
    runStore: { write: async () => undefined },
  });
  return { planning, execution, execute };
}

function scorer(run: (args: ScorerArgs<unknown, unknown, unknown>) => Score) {
  return Object.assign(run, {
    scorerName: "quality" as const,
    costClass: "code" as const,
  });
}

function definition(options: {
  readonly expect?: (context: {
    output: string;
    expect: (value: unknown) => { toBe(expected: unknown): void };
  }) => void;
  readonly scorer?: ReturnType<typeof scorer>;
}) {
  return evaluate({
    id: "support",
    task,
    cases: [{ id: "refund", input: { question: "yes" }, expected: "yes" }],
    ...(options.expect !== undefined ? { expect: options.expect } : {}),
    ...(options.scorer !== undefined ? { scorers: [options.scorer] } : {}),
  });
}

const source = {
  sourceKey: { relativeFile: "support.eval.ts", export: "default" as const },
};

describe("independent Eval assessment", () => {
  it("reuses task evidence while rerunning changed assertions", async () => {
    const run = harness();
    const first = await executeEvalPlan(
      await planEval(
        definition({
          expect: ({ output, expect: assert }) => assert(output).toBe("yes"),
        }),
        source,
        run.planning,
      ),
      run.execution(),
    );
    const second = await executeEvalPlan(
      await planEval(
        definition({
          expect: ({ output, expect: assert }) => assert(output).toBe("no"),
        }),
        source,
        run.planning,
      ),
      run.execution(),
    );

    expect(run.execute).toHaveBeenCalledOnce();
    expect(first.cells[0].assertions.ran).toBe(1);
    expect(second.cells[0]).toMatchObject({
      status: "failed",
      task: { status: "reused", reason: "exact_evidence" },
      assertions: { ran: 1 },
    });
  });

  it("reuses task evidence while always recomputing edited deterministic scorers", async () => {
    const run = harness();
    const firstScorer = vi.fn(() => ({ name: "quality", score: 0.25 }));
    const secondScorer = vi.fn(() => ({ name: "quality", score: 1 }));
    const first = await executeEvalPlan(
      await planEval(
        definition({ scorer: scorer(firstScorer) }),
        source,
        run.planning,
      ),
      run.execution(),
    );
    const second = await executeEvalPlan(
      await planEval(
        definition({ scorer: scorer(secondScorer) }),
        source,
        run.planning,
      ),
      run.execution(),
    );

    expect(run.execute).toHaveBeenCalledOnce();
    expect(firstScorer).toHaveBeenCalledOnce();
    expect(secondScorer).toHaveBeenCalledOnce();
    expect(first.cells[0].scores).toMatchObject([
      {
        status: "computed",
        reason: "deterministic_local",
        name: "quality",
        value: 0.25,
      },
    ]);
    expect(second.cells[0]).toMatchObject({
      task: { status: "reused" },
      scores: [
        {
          status: "computed",
          reason: "deterministic_local",
          name: "quality",
          value: 1,
        },
      ],
    });
  });
});
