import { describe, expect, it, vi } from "vitest";

import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import { attachEvalTaskDescriptorForInternalUse } from "../../src/eval/internal/task";
import { fingerprintEvalValue } from "../../src/eval/internal/identity";
import type {
  EvalEvidenceStore,
  EvalExecutionPorts,
  EvalPlanningPorts,
} from "../../src/eval/internal/ports";
import {
  evalValue,
  memoryEvidenceStore,
  planningPorts,
  taskResult,
} from "./reuse-test-harness";

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

  it("reuses only when the current rendered prompt matches the exact captured prompt", async () => {
    let rendered = "refunds:v1";
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
        projectRenderedPromptIdentity: async () => ({
          reusable: true,
          fingerprintMaterial: { rendered },
        }),
        execute: async () => taskResult(),
        projectOutput: (result) => result.output,
        projectResponse: (result) => result.response,
      },
    );
    const evidenceStore = memoryEvidenceStore();
    const ports = planningPorts(evidenceStore);
    const options = {
      sourceKey: {
        relativeFile: "support.eval.ts",
        export: "default" as const,
      },
    };
    const host = vi.fn(async () => ({
      ...taskResult(),
      renderedPromptFingerprint: fingerprintEvalValue({ rendered }),
    }));
    const execute = (plan: Awaited<ReturnType<typeof planEval>>) =>
      executeEvalPlan(plan, {
        taskHost: { execute: host },
        clock: { now: () => 1 },
        ids: { next: () => "eval-run-1" },
        runStore: { write: async () => undefined },
        evidenceStore,
      });

    await execute(await planEval(evalValue(task), options, ports));
    const unchanged = await planEval(evalValue(task), options, ports);
    expect(unchanged.cells[0]?.action).toMatchObject({
      kind: "reuse",
      reason: "exact_evidence",
    });

    rendered = "refunds:nondeterministic";
    const changed = await planEval(evalValue(task), options, ports);
    expect(changed.cells[0]?.action).toMatchObject({
      kind: "execute",
      reason: "nondeterministic_renderer",
    });
  });

  it("keeps managed renderer evidence fresh when its adapter cannot capture the exact render", async () => {
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
          fingerprintMaterial: {
            prompt: { kind: "managed_renderer" },
          },
        }),
        execute: async () => taskResult(),
        projectOutput: (result) => result.output,
        projectResponse: (result) => result.response,
      },
    );
    const evidenceStore = memoryEvidenceStore();
    const read = vi.spyOn(evidenceStore, "read");

    const plan = await planEval(
      evalValue(task),
      { sourceKey: { relativeFile: "support.eval.ts", export: "default" } },
      planningPorts(evidenceStore),
    );

    expect(plan.cells[0]?.action).toMatchObject({
      kind: "execute",
      reason: "untracked_external_dependency",
    });
    expect(read).not.toHaveBeenCalled();
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
      writeReason: "implicit_media",
    });
  });

  it("explains when redaction policy makes live output ineligible for exact reuse", async () => {
    const evidenceStore = memoryEvidenceStore();
    const plan = await planEval(
      evalValue(),
      { sourceKey: { relativeFile: "support.eval.ts", export: "default" } },
      planningPorts(evidenceStore),
    );
    const run = await executeEvalPlan(plan, {
      taskHost: {
        execute: async () => taskResult({ answer: "yes", apiKey: "secret" }),
      },
      clock: { now: () => 1 },
      ids: { next: () => "eval-run-1" },
      runStore: { write: async () => undefined },
      evidenceStore,
    });

    expect(evidenceStore.entries.size).toBe(0);
    expect(run.provenance.evidenceStore).toMatchObject({
      write: "not_eligible",
      writeReason: "capture_policy",
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
      { schemaVersion: 1, taskEvidenceCacheEpoch: 2, status: "complete" },
    ],
    ["error", { schemaVersion: 1, taskEvidenceCacheEpoch: 9, status: "error" }],
    [
      "partial",
      { schemaVersion: 1, taskEvidenceCacheEpoch: 9, status: "partial" },
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
});
