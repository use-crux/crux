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
import type { EvalTaskHostRequest } from "../../src/eval/internal/types";

const source = {
  sourceKey: { relativeFile: "support.eval.ts", export: "default" as const },
};
const taskMaterials = new WeakMap<object, Readonly<Record<string, unknown>>>();

describe("Eval invalidation matrix", () => {
  it("invalidates only the cells whose task-affecting identity changed", async () => {
    const harness = createHarness();
    const baseTask = managedTask({
      prompt: "prompt-v1",
      model: "model-v1",
      settings: { temperature: 0 },
    });
    await executeEvalPlan(
      await planEval(
        definition(baseTask, [
          { id: "a", input: { value: 1 }, call: { seed: 1 } },
        ]),
        source,
        harness.planning,
      ),
      harness.execution,
    );

    const cases = [
      {
        name: "expected",
        eval: definition(baseTask, [
          {
            id: "a",
            input: { value: 1 },
            call: { seed: 1 },
            expected: "changed",
          },
        ]),
        actions: ["reuse"],
      },
      {
        name: "input",
        eval: definition(baseTask, [
          { id: "a", input: { value: 2 }, call: { seed: 1 } },
        ]),
        actions: ["execute"],
      },
      {
        name: "call",
        eval: definition(baseTask, [
          { id: "a", input: { value: 1 }, call: { seed: 2 } },
        ]),
        actions: ["execute"],
      },
      {
        name: "Case timeout",
        eval: definition(baseTask, [
          {
            id: "a",
            input: { value: 1 },
            call: { seed: 1 },
            timeout: { totalMs: 1_000 },
          },
        ]),
        actions: ["execute"],
      },
      {
        name: "trial count",
        eval: definition(
          baseTask,
          [{ id: "a", input: { value: 1 }, call: { seed: 1 } }],
          { trials: 2 },
        ),
        actions: ["reuse", "execute"],
      },
      {
        name: "new Case",
        eval: definition(baseTask, [
          { id: "a", input: { value: 1 }, call: { seed: 1 } },
          { id: "b", input: { value: 1 }, call: { seed: 1 } },
        ]),
        actions: ["reuse", "execute"],
      },
      ...(["prompt", "model", "settings"] as const).map((field) => ({
        name: field,
        eval: definition(
          managedTask({
            prompt: "prompt-v1",
            model: "model-v1",
            settings: { temperature: 0 },
            [field]: `${field}-v2`,
          }),
          [{ id: "a", input: { value: 1 }, call: { seed: 1 } }],
        ),
        actions: ["execute"],
      })),
    ];

    for (const entry of cases) {
      const plan = await planEval(entry.eval, source, harness.planning);
      expect(
        plan.cells.map((cell) => cell.action.kind),
        entry.name,
      ).toEqual(entry.actions);
      expect(
        plan.cells
          .filter((cell) => cell.action.kind === "execute")
          .map((cell) => cell.action.reason),
        `${entry.name} reasons`,
      ).toEqual(
        entry.actions
          .filter((action) => action === "execute")
          .map(() => "no_exact_evidence"),
      );
    }

    harness.identity.managedTaskFingerprint = "registry-v2";
    expect(
      (
        await planEval(
          definition(baseTask, [
            { id: "a", input: { value: 1 }, call: { seed: 1 } },
          ]),
          source,
          harness.planning,
        )
      ).cells[0]?.action,
    ).toMatchObject({ kind: "execute", reason: "no_exact_evidence" });
    harness.identity.managedTaskFingerprint = "registry-v1";
    harness.identity.hostContractFingerprint = "host-v2";
    expect(
      (
        await planEval(
          definition(baseTask, [
            { id: "a", input: { value: 1 }, call: { seed: 1 } },
          ]),
          source,
          harness.planning,
        )
      ).cells[0]?.action,
    ).toMatchObject({ kind: "execute", reason: "no_exact_evidence" });

    expect(harness.execute).toHaveBeenCalledOnce();
  });
});

function definition(
  task: ReturnType<typeof managedTask>,
  cases: readonly Readonly<Record<string, unknown>>[],
  options: { readonly trials?: number } = {},
) {
  return evaluate({
    id: "support",
    task,
    cases: cases as never,
    ...(options.trials !== undefined ? { trials: options.trials } : {}),
  });
}

function managedTask(material: Readonly<Record<string, unknown>>) {
  const identity = Object.freeze({
    reusable: true as const,
    fingerprintMaterial: material,
  });
  const task = attachEvalTaskDescriptorForInternalUse(
    Object.assign(async () => "unused", {
      _tag: "CruxTask" as const,
      operation: "function" as const,
    }),
    {
      _tag: "CruxEvalTaskDescriptor",
      identityEpoch: 2,
      operation: "generate",
      adapterId: "ai-sdk",
      capabilities: [],
      defaults: {},
      overrideKeys: [],
      projectIdentity: () => identity,
      execute: async () => ({ output: "yes" }),
      projectOutput: (result) => result.output,
      projectResponse: () => response(),
    },
  );
  taskMaterials.set(task, material);
  return task;
}

function createHarness() {
  const entries = new Map<string, unknown>();
  const evidenceStore: EvalEvidenceStore = {
    identity: "memory",
    consistency: "read_after_write",
    read: async (key) => entries.get(key),
    write: async (entry) => void entries.set(entry.key, entry),
  };
  const identity = {
    managedTaskFingerprint: "registry-v1",
    hostContractFingerprint: "host-v1",
  };
  const planning: EvalPlanningPorts = {
    evidenceStore,
    costEstimator: { estimate: () => ({ kind: "none" }) },
    taskIdentity: {
      describe: async () => ({
        reusable: true,
        managedTaskFingerprint: identity.managedTaskFingerprint,
        hostContractFingerprint: identity.hostContractFingerprint,
      }),
    },
  };
  const execute = vi.fn(async (request: EvalTaskHostRequest) => ({
    output: "yes",
    response: response(),
    capturedSignals: [],
    runIds: ["task-run-1"],
    metrics: { durationMs: 1 },
    observedIdentity: {
      reusable: true as const,
      fingerprintMaterial: taskMaterials.get(request.task as object) ?? {},
    },
  }));
  const execution: EvalExecutionPorts = {
    evidenceStore,
    taskHost: { execute },
    clock: { now: () => 1 },
    ids: { next: () => "eval-run-1" },
    runStore: { write: async () => undefined },
  };
  return { planning, execution, execute, identity };
}

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
