import { describe, expect, it } from "vitest";

import {
  EVAL_TASK_INTERNAL,
  EVAL_TASK_IDENTITY_EPOCH,
  EvalTaskExecutionError,
  attachEvalTaskDescriptorForInternalUse,
  executeEvalTaskForInternalUse,
  fingerprintManagedEvalTaskForInternalUse,
  getEvalTaskDescriptorForInternalUse,
} from "../../src/eval/internal/task";
import { taskContextProtocolBehavior } from "./task-context-protocol.behavior";
import { managedProtocolTask } from "./task-protocol-fixtures";

describe("Eval task execution protocol", () => {
  taskContextProtocolBehavior();

  it("rejects a callable that was not created as a managed Eval task", async () => {
    const task = async (input: { question: string }) => input.question;

    await expect(
      executeEvalTaskForInternalUse(task, { question: "Refund?" }),
    ).rejects.toMatchObject({
      name: "EvalTaskExecutionError",
      code: "descriptor_missing",
    });

    await expect(
      executeEvalTaskForInternalUse(task, { question: "Refund?" }),
    ).rejects.toThrowError(EvalTaskExecutionError);
    await expect(
      executeEvalTaskForInternalUse(task, { question: "Refund?" }),
    ).rejects.toThrowError(/generate\.task\(\).*stream\.task\(\)/);
  });

  it("executes a compatible descriptor branded with the global symbol", async () => {
    const task = async () => ({ answer: "production" });
    Object.defineProperty(
      task,
      Symbol.for("@use-crux/core/eval/task-descriptor"),
      {
        value: Object.freeze({
          _tag: "CruxEvalTaskDescriptor",
          identityEpoch: EVAL_TASK_IDENTITY_EPOCH,
          operation: "generate",
          adapterId: "ai-sdk",
          promptId: "support",
          inputSchema: undefined,
          outputSchema: undefined,
          capabilities: Object.freeze(["modelCalls"]),
          defaults: Object.freeze({}),
          overrideKeys: Object.freeze([]),
          projectIdentity: ({ phase }: { phase: "plan" | "observed" }) => ({
            reusable: true as const,
            fingerprintMaterial: { phase: phase === "plan" ? "same" : "same" },
          }),
          execute: async (input: unknown) => ({ object: input }),
          projectOutput: (result: { object: unknown }) => result.object,
          projectResponse: (result: { object: unknown }) =>
            ({ object: result.object }) as never,
        }),
      },
    );

    expect(EVAL_TASK_INTERNAL).toBe(
      Symbol.for("@use-crux/core/eval/task-descriptor"),
    );
    await expect(
      executeEvalTaskForInternalUse(task, "semantic"),
    ).resolves.toMatchObject({
      output: "semantic",
      response: { object: "semantic" },
      observedIdentity: {
        reusable: true,
        fingerprintMaterial: { phase: "same" },
      },
    });
  });

  it("rejects a frozen projector-less descriptor before invocation", async () => {
    let invocations = 0;
    const task = async () => undefined;
    const { projectIdentity: _projectIdentity, ...legacy } =
      compatibleDescriptor(async () => {
        invocations += 1;
        return { object: "unexpected" };
      });
    Object.defineProperty(task, EVAL_TASK_INTERNAL, {
      value: Object.freeze(legacy),
    });

    await expect(
      executeEvalTaskForInternalUse(task, undefined),
    ).rejects.toMatchObject({ code: "descriptor_incompatible" });
    expect(invocations).toBe(0);
  });

  it("rejects a malformed branded descriptor before invoking it", async () => {
    let invocations = 0;
    const task = async () => undefined;
    Object.defineProperty(task, EVAL_TASK_INTERNAL, {
      value: {
        _tag: "CruxEvalTaskDescriptor",
        operation: "generate",
        adapterId: "ai-sdk",
        execute: async () => {
          invocations += 1;
        },
      },
    });

    await expect(
      executeEvalTaskForInternalUse(task, undefined),
    ).rejects.toMatchObject({
      code: "descriptor_incompatible",
    });
    await expect(
      executeEvalTaskForInternalUse(task, undefined),
    ).rejects.toThrowError(
      /mixed fixed versions.*align.*same compatible release/i,
    );
    expect(invocations).toBe(0);
  });

  it("rejects a branded non-callable object before invoking its descriptor", async () => {
    let invocations = 0;
    const task = {};
    Object.defineProperty(task, EVAL_TASK_INTERNAL, {
      value: {
        _tag: "CruxEvalTaskDescriptor",
        operation: "generate",
        adapterId: "ai-sdk",
        capabilities: ["modelCalls"],
        defaults: {},
        overrideKeys: [],
        execute: async () => {
          invocations += 1;
          return { object: "unexpected" };
        },
        projectOutput: (result: { object: unknown }) => result.object,
        projectResponse: () => ({}) as never,
      },
    });

    await expect(
      executeEvalTaskForInternalUse(
        task as unknown as () => Promise<unknown>,
        undefined,
      ),
    ).rejects.toMatchObject({ code: "descriptor_missing" });
    expect(invocations).toBe(0);
  });

  it.each([
    {
      name: "outer descriptor",
      build: (execute: () => Promise<unknown>) => ({
        ...compatibleDescriptor(execute),
      }),
    },
    {
      name: "capabilities shell",
      build: (execute: () => Promise<unknown>) =>
        Object.freeze({
          ...compatibleDescriptor(execute),
          capabilities: ["modelCalls"],
        }),
    },
    {
      name: "defaults shell",
      build: (execute: () => Promise<unknown>) =>
        Object.freeze({
          ...compatibleDescriptor(execute),
          defaults: {},
        }),
    },
    {
      name: "overrideKeys shell",
      build: (execute: () => Promise<unknown>) =>
        Object.freeze({
          ...compatibleDescriptor(execute),
          overrideKeys: [] as string[],
        }),
    },
  ])("rejects a mutable $name before invocation", async ({ build }) => {
    let invocations = 0;
    const task = async () => undefined;
    Object.defineProperty(task, EVAL_TASK_INTERNAL, {
      value: build(async () => {
        invocations += 1;
        return { object: "unexpected" };
      }),
    });

    await expect(
      executeEvalTaskForInternalUse(task, undefined),
    ).rejects.toMatchObject({ code: "descriptor_incompatible" });
    expect(invocations).toBe(0);
  });

  it.each(["inputSchema", "outputSchema"] as const)(
    "rejects a malformed %s envelope before invocation",
    async (schemaKey) => {
      let invocations = 0;
      const task = async () => undefined;
      const descriptor = compatibleDescriptor(async () => {
        invocations += 1;
        return { object: "unexpected" };
      });
      Object.defineProperty(task, EVAL_TASK_INTERNAL, {
        value: Object.freeze({ ...descriptor, [schemaKey]: {} }),
      });

      await expect(
        executeEvalTaskForInternalUse(task, undefined),
      ).rejects.toMatchObject({ code: "descriptor_incompatible" });
      expect(invocations).toBe(0);
    },
  );

  it("attaches immutable hidden protocol state before freezing the callable", () => {
    const task = (input: unknown) => Promise.resolve(input);
    const schema = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
      },
    };
    attachEvalTaskDescriptorForInternalUse(task, {
      _tag: "CruxEvalTaskDescriptor",
      identityEpoch: EVAL_TASK_IDENTITY_EPOCH,
      operation: "generate",
      adapterId: "ai-sdk",
      inputSchema: schema,
      outputSchema: schema,
      capabilities: ["modelCalls"],
      defaults: { temperature: 0.2 },
      overrideKeys: ["temperature"],
      projectIdentity: ({ phase }) => ({
        reusable: true,
        fingerprintMaterial: { phase },
      }),
      execute: task,
      projectOutput: (result) => result,
      projectResponse: () => ({}) as never,
    });

    const property = Object.getOwnPropertyDescriptor(task, EVAL_TASK_INTERNAL);
    const descriptor = getEvalTaskDescriptorForInternalUse(task);
    expect(property).toMatchObject({
      enumerable: false,
      writable: false,
      configurable: false,
    });
    expect(Object.isFrozen(task)).toBe(true);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.capabilities)).toBe(true);
    expect(Object.isFrozen(descriptor.defaults)).toBe(true);
    expect(Object.isFrozen(descriptor.overrideKeys)).toBe(true);
    expect(descriptor.inputSchema).toBe(schema);
    expect(descriptor.outputSchema).toBe(schema);
    expect(Object.isFrozen(schema)).toBe(false);
  });

  it("identifies managed task contracts without hashing JavaScript source rendering", () => {
    const local = managedProtocolTask(
      async () => ({ object: "local closure" }),
      undefined,
    );
    const remote = managedProtocolTask(
      async () => ({ object: "different remote closure" }),
      ["record-store"],
    );
    const originalToString = Function.prototype.toString;
    let localFingerprint: string;
    let remoteFingerprint: string;

    try {
      Object.defineProperty(Function.prototype, "toString", {
        configurable: true,
        writable: true,
        value: () => {
          throw new Error("task identity must not inspect function source");
        },
      });
      localFingerprint = fingerprintManagedEvalTaskForInternalUse(
        local,
        "generated-definition-v1",
      );
      remoteFingerprint = fingerprintManagedEvalTaskForInternalUse(
        remote,
        "generated-definition-v1",
      );
    } finally {
      Object.defineProperty(Function.prototype, "toString", {
        configurable: true,
        writable: true,
        value: originalToString,
      });
    }

    expect(EVAL_TASK_IDENTITY_EPOCH).toBe(2);
    expect(localFingerprint!).toBe(remoteFingerprint!);
    expect(
      fingerprintManagedEvalTaskForInternalUse(
        local,
        "generated-definition-v2",
      ),
    ).not.toBe(localFingerprint!);
  });
});

function compatibleDescriptor(execute: () => Promise<unknown>) {
  return Object.freeze({
    _tag: "CruxEvalTaskDescriptor",
    identityEpoch: EVAL_TASK_IDENTITY_EPOCH,
    operation: "generate",
    adapterId: "ai-sdk",
    capabilities: Object.freeze(["modelCalls"]),
    defaults: Object.freeze({}),
    overrideKeys: Object.freeze([]),
    projectIdentity: ({ phase }: { phase: "plan" | "observed" }) => ({
      reusable: true as const,
      fingerprintMaterial: { phase },
    }),
    execute,
    projectOutput: (result: { object?: unknown }) => result.object,
    projectResponse: () => ({}) as never,
  });
}
