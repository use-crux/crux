import { describe, expect, it, vi } from "vitest";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import { attachEvalTaskDescriptorForInternalUse } from "../../src/eval/internal/task";
import {
  evalValue,
  memoryEvidenceStore,
  planningPorts,
  task,
  taskResult,
} from "./reuse-test-harness";

const source = {
  sourceKey: { relativeFile: "support.eval.ts", export: "default" as const },
};

describe("Eval Runtime placement", () => {
  it("does not resolve a deployment for portable local work", async () => {
    const resolve = vi.fn();
    const evidence = memoryEvidenceStore();
    const plan = await planEval(evalValue(task), source, {
      ...planningPorts(evidence),
      hostReadiness: { resolve },
    });

    expect(resolve).not.toHaveBeenCalled();
    expect(plan.hostReadiness).toEqual({
      status: "local",
      reason: "no_required_host_work",
    });
  });

  it("does not turn an opaque task's unavailable identity into a host requirement", async () => {
    const resolve = vi.fn();
    const opaqueTask = async () => "opaque";
    const plan = await planEval(evalValue(opaqueTask), source, {
      ...planningPorts(memoryEvidenceStore()),
      hostReadiness: { resolve },
    });

    expect(plan.cells[0]?.action).toMatchObject({
      kind: "execute",
      reason: "identity_unavailable",
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(plan.hostReadiness).toEqual({
      status: "local",
      reason: "no_required_host_work",
    });
  });

  it("does not resolve a deployment when required-host work is an exact hit", async () => {
    const evidence = memoryEvidenceStore();
    const remoteTask = requiredHostTask();
    const first = await planEval(evalValue(remoteTask), source, {
      ...planningPorts(evidence),
      hostReadiness: {
        resolve: async () => ({
          status: "verified",
          deploymentId: "production",
          hostKind: "memory",
        }),
      },
    });
    await executeEvalPlan(first, {
      taskHost: { execute: async () => taskResult() },
      clock: { now: () => 1 },
      ids: { next: () => "run-1" },
      runStore: { write: async () => undefined },
      evidenceStore: evidence,
    });

    const resolve = vi.fn();
    const second = await planEval(evalValue(remoteTask), source, {
      ...planningPorts(evidence),
      hostReadiness: { resolve },
    });

    expect(second.cells[0]?.action.kind).toBe("reuse");
    expect(resolve).not.toHaveBeenCalled();
    expect(second.hostReadiness).toEqual({
      status: "local",
      reason: "exact_evidence",
    });
  });
});

function requiredHostTask() {
  return attachEvalTaskDescriptorForInternalUse(
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
      requiredHostCapabilities: ["record-store"],
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
}
