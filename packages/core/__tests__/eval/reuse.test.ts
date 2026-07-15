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
    execute: async () => taskResult(),
    projectOutput: (result) => result.output,
    projectResponse: (result) => result.response,
  },
);

function evalValue(taskValue = task) {
  return evaluate({
    id: "support",
    task: taskValue,
    cases: [{ id: "refund", input: { question: "yes" } }],
  });
}

function memoryEvidenceStore(): EvalEvidenceStore & {
  readonly entries: Map<string, unknown>;
} {
  const entries = new Map<string, unknown>();
  return {
    identity: "memory",
    consistency: "read_after_write",
    entries,
    read: async (key) => entries.get(key),
    write: async (entry) => void entries.set(entry.key, entry),
  };
}

function planningPorts(evidenceStore: EvalEvidenceStore): EvalPlanningPorts {
  return {
    evidenceStore,
    taskIdentity: {
      describe: async () => ({
        managedTaskFingerprint: "task-v1",
        hostContractFingerprint: "host-v1",
        reusable: true,
      }),
    },
  };
}

function taskResult(
  output: unknown = "yes",
  fingerprintMaterial: Readonly<Record<string, unknown>> = {
    adapter: "fake-v1",
  },
) {
  return {
    output,
    response: {
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
    },
    capturedSignals: [],
    runIds: ["task-run-1"],
    metrics: { durationMs: 20 },
    observedIdentity: { reusable: true as const, fingerprintMaterial },
  };
}

describe("automatic exact Eval task reuse", () => {
  it("writes successful evidence once and reuses it on an identical second run", async () => {
    const evidenceStore = memoryEvidenceStore();
    const hostExecute = vi.fn(async () => taskResult());
    let runNumber = 0;
    const executionPorts = (): EvalExecutionPorts => ({
      taskHost: { execute: hostExecute },
      clock: { now: () => ++runNumber },
      ids: { next: () => `eval-run-${runNumber}` },
      runStore: { write: async () => undefined },
      evidenceStore,
    });
    const options = {
      sourceKey: {
        relativeFile: "support.eval.ts",
        export: "default" as const,
      },
    };

    const firstPlan = await planEval(
      evalValue(),
      options,
      planningPorts(evidenceStore),
    );
    const first = await executeEvalPlan(firstPlan, executionPorts());
    const secondPlan = await planEval(
      evalValue(),
      options,
      planningPorts(evidenceStore),
    );
    const second = await executeEvalPlan(secondPlan, executionPorts());

    expect(hostExecute).toHaveBeenCalledOnce();
    expect(evidenceStore.entries.size).toBe(1);
    expect(first.cells[0]?.task).toMatchObject({
      status: "executed",
      reason: "no_exact_evidence",
    });
    expect(second.cells[0]).toMatchObject({
      status: "passed",
      task: {
        status: "reused",
        reason: "exact_evidence",
      },
      output: "yes",
      runIds: ["task-run-1"],
    });
    expect(second.provenance.evidenceStore).toMatchObject({
      identity: "memory",
      consistency: "read_after_write",
      write: "not_attempted",
    });
  });

  it("explains a best-effort write failure without falsifying the run", async () => {
    const evidenceStore: EvalEvidenceStore = {
      identity: "shared",
      consistency: "eventual",
      read: async () => undefined,
      write: async () => {
        throw new Error("read-only store");
      },
    };
    const plan = await planEval(
      evalValue(),
      { sourceKey: { relativeFile: "support.eval.ts", export: "default" } },
      planningPorts(evidenceStore),
    );
    const run = await executeEvalPlan(plan, {
      taskHost: { execute: async () => taskResult() },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
      evidenceStore,
    });

    expect(run).toMatchObject({
      status: "complete",
      passed: true,
      provenance: {
        evidenceStore: {
          identity: "shared",
          consistency: "eventual",
          write: "failed",
        },
      },
    });
  });

  it("never writes implicit binary output as reusable evidence", async () => {
    const evidenceStore = memoryEvidenceStore();
    const plan = await planEval(
      evalValue(),
      { sourceKey: { relativeFile: "support.eval.ts", export: "default" } },
      planningPorts(evidenceStore),
    );
    const run = await executeEvalPlan(plan, {
      taskHost: {
        execute: async () => taskResult(new Uint8Array([1, 2, 3])),
      },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
      evidenceStore,
    });

    expect(evidenceStore.entries.size).toBe(0);
    expect(run.provenance.evidenceStore).toMatchObject({
      write: "not_eligible",
    });
  });

  it("does not write evidence when observed adapter identity differs", async () => {
    const evidenceStore = memoryEvidenceStore();
    const plan = await planEval(
      evalValue(),
      { sourceKey: { relativeFile: "support.eval.ts", export: "default" } },
      planningPorts(evidenceStore),
    );
    const run = await executeEvalPlan(plan, {
      taskHost: {
        execute: async () => taskResult("yes", { adapter: "changed-v2" }),
      },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
      evidenceStore,
    });

    expect(run).toMatchObject({ status: "complete", passed: true });
    expect(evidenceStore.entries.size).toBe(0);
    expect(run.provenance.evidenceStore).toMatchObject({
      write: "not_eligible",
      writeReason: "observed_identity_mismatch",
    });
  });

  it("executes but bypasses evidence when the adapter cannot prove identity", async () => {
    const dynamicTask = attachEvalTaskDescriptorForInternalUse(
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
          reusable: false,
          reason: "untracked_external_dependency",
        }),
        execute: async () => taskResult(),
        projectOutput: (result) => result.output,
        projectResponse: (result) => result.response,
      },
    );
    const evidenceStore = memoryEvidenceStore();
    const read = vi.spyOn(evidenceStore, "read");
    const plan = await planEval(
      evalValue(dynamicTask),
      { sourceKey: { relativeFile: "support.eval.ts", export: "default" } },
      planningPorts(evidenceStore),
    );
    const host = vi.fn(async () => taskResult());
    const run = await executeEvalPlan(plan, {
      taskHost: { execute: host },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
      evidenceStore,
    });

    expect(plan.cells[0].action).toMatchObject({
      kind: "execute",
      reason: "untracked_external_dependency",
    });
    expect(host).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
    expect(evidenceStore.entries.size).toBe(0);
    expect(run.provenance.evidenceStore).toMatchObject({
      write: "not_attempted",
    });
  });

  it("does not write when the observed adapter identity becomes unprovable", async () => {
    const evidenceStore = memoryEvidenceStore();
    const plan = await planEval(
      evalValue(),
      { sourceKey: { relativeFile: "support.eval.ts", export: "default" } },
      planningPorts(evidenceStore),
    );
    const run = await executeEvalPlan(plan, {
      taskHost: {
        execute: async () => ({
          ...taskResult(),
          observedIdentity: {
            reusable: false,
            reason: "implicit_media" as const,
          },
        }),
      },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
      evidenceStore,
    });

    expect(evidenceStore.entries.size).toBe(0);
    expect(run.provenance.evidenceStore).toMatchObject({
      write: "not_eligible",
      writeReason: "implicit_media",
    });
  });

  it.each([
    ["corrupt", { nope: true }],
    [
      "old epoch",
      { schemaVersion: 1, outputCacheEpoch: 2, status: "complete" },
    ],
    ["error", { schemaVersion: 1, outputCacheEpoch: 3, status: "error" }],
    ["partial", { schemaVersion: 1, outputCacheEpoch: 3, status: "partial" }],
  ])("treats a %s entry as a miss", async (_label, invalidEntry) => {
    const evidenceStore = memoryEvidenceStore();
    const ports: EvalPlanningPorts = {
      evidenceStore: {
        ...evidenceStore,
        read: async () => invalidEntry,
      },
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
});
