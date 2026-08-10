import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "../../src";
import { agent } from "../../src/agent";
import { createLoopAgentExecutor } from "../../src/adapter/execution/loop-agent-executor";
import type {
  ExecutorGenerateOptions,
  ExecutorGenerateResult,
} from "../../src/adapter/executor-contracts";
import { createAgentWorkHost, spawn } from "../../src/work";

describe("createLoopAgentExecutor steering bridge", () => {
  it("forwards signal and projectStepMessages so steering appears FIFO once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const providerSteps: Array<readonly unknown[]> = [];
    const generate = vi.fn(
      async (
        _prompt: unknown,
        options: ExecutorGenerateOptions<string>,
      ): Promise<ExecutorGenerateResult<unknown>> => {
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(typeof options.projectStepMessages).toBe("function");
        await gate;
        const first = (await options.projectStepMessages?.()) ?? [];
        providerSteps.push(first);
        const second = (await options.projectStepMessages?.()) ?? [];
        providerSteps.push(second);
        return {
          text: "bridged",
          object: undefined,
          steps: Object.freeze([]),
          _meta: Object.freeze({ usage: undefined }),
        } as ExecutorGenerateResult<unknown>;
      },
    );

    const executor = createLoopAgentExecutor(generate);
    const childAgent = agent({
      id: "bridge-child",
      description: "Bridge child",
      prompt: prompt({
        id: "bridge-child-prompt",
        input: z.object({ task: z.string() }),
        prompt: ({ input }) => input.task,
      }),
    });

    const host = createAgentWorkHost({ executor });
    const handle = await host.run(() =>
      spawn(childAgent, { task: "start" }),
    );

    await handle.send("first guidance");
    await handle.send("second guidance");
    release();
    await expect(handle.result()).resolves.toBe("bridged");

    expect(generate).toHaveBeenCalledTimes(1);
    expect(providerSteps[0]).toEqual([
      {
        role: "user",
        content: "first guidance",
        metadata: { provenance: "agent-steering" },
      },
      {
        role: "user",
        content: "second guidance",
        metadata: { provenance: "agent-steering" },
      },
    ]);
    expect(providerSteps[1]).toEqual([]);
  });
});
