import { describe, expect, it } from "vitest";
import { evaluate } from "../../../src/eval";
import {
  attachEvalTaskDescriptorForInternalUse,
  EVAL_TASK_INTERNAL,
} from "../../../src/eval/internal/task";
import {
  projectDeployedEvalRequiredHostCapabilities,
  projectEvalExecutionArms,
  projectEvalTaskExecution,
} from "../../../src/runtime/eval-registry";

function managedTask(requiredHostCapabilities: readonly (
  | "asset-store"
  | "record-store"
  | "vector-store"
)[] = []) {
  return attachEvalTaskDescriptorForInternalUse(
    async (input: string) => input,
    {
      _tag: "CruxEvalTaskDescriptor",
      operation: "generate",
      adapterId: "ai-sdk",
      capabilities: [],
      requiredHostCapabilities,
      callContractFingerprint: "projection-call-v1",
      defaults: {},
      overrideKeys: [],
      projectIdentity: () => ({
        reusable: true,
        fingerprintMaterial: { task: "projection-fixture" },
      }),
      execute: async (input) => ({ output: input }),
      projectOutput: (result) => result.output,
      projectResponse: (result) => ({ output: result.output }),
    },
  );
}

describe("Eval execution projection", () => {
  it("classifies a non-callable authored task without throwing", () => {
    expect(projectEvalTaskExecution({})).toEqual({
      status: "invalid",
      code: "task_not_callable",
      reason: "Eval task must be callable.",
    });
  });

  it("classifies an incompatible adapter task contract without throwing", () => {
    const task = async (input: string) => input;
    Object.defineProperty(task, EVAL_TASK_INTERNAL, {
      value: { _tag: "CruxEvalTaskDescriptor" },
    });

    expect(projectEvalTaskExecution(task)).toMatchObject({
      status: "invalid",
      code: "task_contract_incompatible",
      reason: expect.stringContaining("align both packages"),
    });
  });

  it("keeps an ordinary callable in the coordinator", () => {
    const evalValue = evaluate({
      id: "deterministic",
      task: async (input: string) => input.toUpperCase(),
      cases: [{ input: "hello" }],
    });

    expect(projectEvalExecutionArms(evalValue)).toEqual([
      {
        status: "ready",
        name: "current",
        fingerprint: expect.any(String),
        execution: "coordinator",
        requiredHostCapabilities: [],
      },
    ]);
    expect(projectDeployedEvalRequiredHostCapabilities(evalValue)).toEqual([]);
  });

  it("keeps a managed task without host requirements in the coordinator", () => {
    const evalValue = evaluate({
      id: "portable",
      task: managedTask(),
      cases: [{ input: "hello" }],
    });

    expect(projectEvalExecutionArms(evalValue)[0]).toMatchObject({
      status: "ready",
      name: "current",
      execution: "coordinator",
      requiredHostCapabilities: [],
    });
  });

  it("places a managed task with normalized host requirements in the runtime", () => {
    const evalValue = evaluate({
      id: "hosted",
      task: managedTask(["vector-store", "asset-store", "vector-store"]),
      cases: [{ input: "hello" }],
    });

    expect(projectEvalExecutionArms(evalValue)[0]).toMatchObject({
      status: "ready",
      name: "current",
      execution: "runtime",
      requiredHostCapabilities: ["asset-store", "vector-store"],
    });
  });
});
