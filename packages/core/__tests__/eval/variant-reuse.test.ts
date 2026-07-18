import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { evaluate } from "../../src/eval/evaluate";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import type {
  EvalEvidenceStore,
  EvalExecutionPorts,
  EvalPlanningPorts,
} from "../../src/eval/internal/ports";
import type { EvalTaskHostRequest } from "../../src/eval/internal/types";
import { attachEvalTaskDescriptorForInternalUse } from "../../src/eval/internal/task";

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
    callContractFingerprint: "test.generate.call.v1",
    defaults: {},
    overrideKeys: ["temperature"],
    projectIdentity: (request) => ({
      reusable: true,
      fingerprintMaterial: { overrides: request.overrides },
    }),
    execute: async () => ({ output: "yes" }),
    projectOutput: (result) => result.output,
    projectResponse: () => response("yes"),
  },
);

function response(output: string) {
  return {
    content: [],
    text: output,
    steps: [],
    finalStep: {
      content: [],
      text: output,
      finishReason: "stop",
      responseId: "response-1",
      modelId: "fake",
      warnings: [],
    },
    messages: [],
    warnings: [],
  };
}

function definition(withCandidate: boolean) {
  return evaluate({
    id: "support",
    task,
    cases: [{ id: "refund", input: { question: "yes" } }],
    ...(withCandidate ? { variants: { cheaper: { temperature: 0 } } } : {}),
  });
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
    costEstimator: { estimate: () => ({ kind: "none" }) },
    taskIdentity: {
      describe: async () => ({
        reusable: true,
        managedTaskFingerprint: "registry-v1",
        hostContractFingerprint: "host-v1",
      }),
    },
  };
  const execute = vi.fn(async (request: EvalTaskHostRequest) => ({
    output: "yes",
    response: response("yes"),
    capturedSignals: [],
    runIds: [`task-run-${request.variant}`],
    metrics: { durationMs: 1 },
    observedIdentity: {
      reusable: true as const,
      fingerprintMaterial: { overrides: request.overrides },
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

const source = {
  sourceKey: { relativeFile: "support.eval.ts", export: "default" as const },
};

describe("Variant-local exact reuse", () => {
  it("rejects an untyped replacement task that cannot accept a selected Case", async () => {
    const incompatible = attachEvalTaskDescriptorForInternalUse(
      Object.assign(async () => "unused", {
        _tag: "CruxTask" as const,
        operation: "function" as const,
      }),
      {
        _tag: "CruxEvalTaskDescriptor",
        operation: "generate",
        adapterId: "ai-sdk",
        inputSchema: z.object({ accountId: z.string() }),
        capabilities: [],
        callContractFingerprint: "test.generate.call.v1",
        defaults: {},
        overrideKeys: [],
        projectIdentity: () => ({
          reusable: true,
          fingerprintMaterial: { task: "incompatible" },
        }),
        execute: async () => ({ output: "yes" }),
        projectOutput: (result) => result.output,
        projectResponse: () => response("yes"),
      },
    );
    const evalValue = evaluate({
      id: "support",
      task,
      cases: [{ id: "refund", input: { question: "yes" } }],
      variants: { incompatible: { task: incompatible } } as never,
    });

    await expect(planEval(evalValue, source)).rejects.toThrowError(
      /Variant 'incompatible'.*does not accept Case 'refund'.*accountId/,
    );
  });

  it("runs only a newly added candidate after reusing cached Current", async () => {
    const run = harness();
    const initialPlan = await planEval(definition(false), source, run.planning);
    await executeEvalPlan(initialPlan, run.execution());
    const expandedPlan = await planEval(definition(true), source, run.planning);
    const expanded = await executeEvalPlan(expandedPlan, run.execution());

    expect(expandedPlan.cells).toMatchObject([
      { variant: "current", action: { kind: "reuse" } },
      {
        variant: "cheaper",
        action: { kind: "execute", reason: "no_exact_evidence" },
      },
    ]);
    expect(expandedPlan.arms[0]?.fingerprint).toBe(
      initialPlan.arms[0]?.fingerprint,
    );
    expect(run.execute.mock.calls.map(([request]) => request.variant)).toEqual([
      "current",
      "cheaper",
    ]);
    expect(expanded.cells).toMatchObject([
      { variant: "current", task: { status: "reused" } },
      { variant: "cheaper", task: { status: "executed" } },
    ]);
  });
});
