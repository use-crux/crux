import { expect, it } from "vitest";
import { evalContext } from "../../src/eval";
import { withEvalContext } from "../../src/eval/testing";
import {
  EVAL_TASK_IDENTITY_EPOCH,
  EVAL_TASK_INTERNAL,
  attachEvalTaskDescriptorForInternalUse,
  executeEvalTaskForInternalUse,
} from "../../src/eval/internal/task";

function compatibleDescriptor(execute: () => Promise<unknown>) {
  return Object.freeze({
    _tag: "CruxEvalTaskDescriptor" as const,
    identityEpoch: EVAL_TASK_IDENTITY_EPOCH,
    operation: "generate" as const,
    adapterId: "ai-sdk",
    capabilities: Object.freeze(["modelCalls"]),
    defaults: Object.freeze({}),
    overrideKeys: Object.freeze([]),
    projectIdentity: () => ({
      reusable: true as const,
      fingerprintMaterial: { adapter: "fixture" },
    }),
    execute,
    projectOutput: (result: unknown) => result,
    projectResponse: () => ({}) as never,
  });
}

/** Register descriptor epoch and exact Eval context protocol behavior. */
export function taskContextProtocolBehavior(): void {
  it("rejects the previous descriptor execution epoch before invocation", async () => {
    let invocations = 0;
    const task = async () => undefined;
    Object.defineProperty(task, EVAL_TASK_INTERNAL, {
      value: Object.freeze({
        ...compatibleDescriptor(async () => {
          invocations += 1;
          return { object: "unexpected" };
        }),
        identityEpoch: 1,
      }),
    });

    await expect(
      executeEvalTaskForInternalUse(task, undefined),
    ).rejects.toMatchObject({ code: "descriptor_incompatible" });
    expect(invocations).toBe(0);
    expect(EVAL_TASK_IDENTITY_EPOCH).toBe(2);
  });

  it("passes the exact active task context through the private descriptor seam", async () => {
    const controller = new AbortController();
    let receivedContext: unknown;
    let activeContext: ReturnType<typeof evalContext> | undefined;
    const task = attachEvalTaskDescriptorForInternalUse(async () => undefined, {
      ...compatibleDescriptor(async (...args: unknown[]) => {
        receivedContext = args[3];
        return { object: "complete" };
      }),
      projectOutput: (result: { object: string }) => result.object,
    });

    await withEvalContext(
      {
        signal: controller.signal,
        timeout: { stepMs: 50, tools: { search: null } },
      },
      async () => {
        activeContext = evalContext();
        await executeEvalTaskForInternalUse(task, undefined);
      },
    );

    expect(receivedContext).toMatchObject({
      signal: controller.signal,
      timeout: { stepMs: 50, tools: { search: null } },
    });
    expect((receivedContext as typeof activeContext)?.signal).toBe(
      controller.signal,
    );
    expect((receivedContext as typeof activeContext)?.timeout).toBe(
      activeContext?.timeout,
    );
  });
}
