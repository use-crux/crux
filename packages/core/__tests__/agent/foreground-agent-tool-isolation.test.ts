import { expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "../../src";
import { agent } from "../../src/agent";
import type { AgentExecutor } from "../../src/agent/executor";
import {
  bindForegroundAgentTools,
  type ForegroundChildWorkPort,
} from "../../src/agent/foreground-tool-binder";
import type { ToolExecutionOptions } from "../../src/types/tool";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";

function boundChild(
  child: ReturnType<typeof agent>,
  executor: AgentExecutor,
  work: ForegroundChildWorkPort,
) {
  const tools = bindForegroundAgentTools({ child }, { executor, model: "model", work });
  return (tools.child as { execute(input: unknown, options: ToolExecutionOptions): Promise<unknown> });
}

it("passes a child only its declared input and own Agent definition", async () => {
  const ownTool = { description: "own", execute: () => "own" };
  const parentOnlyTool = { description: "parent", execute: () => "parent" };
  const child = agent({
    id: "child",
    description: "child",
    prompt: prompt({ input: z.object({ request: z.string() }), prompt: () => "child" }),
    tools: { ownTool },
  });
  const executor = vi.fn<AgentExecutor>().mockResolvedValue({
    agentId: "child", output: { answer: "exact" }, durationMs: 1,
  });
  const work: ForegroundChildWorkPort = {
    async spawn(run) {
      return { result: () => run(new AbortController().signal) };
    },
  };

  const result = await boundChild(child, executor, work).execute(
    { request: "declared" },
    { toolCallId: "call", runtimeContext: { parentOnlyTool } },
  );

  expect(result).toEqual({ answer: "exact" });
  expect(executor).toHaveBeenCalledWith(child, {
    input: { request: "declared" },
    model: "model",
    signal: expect.any(AbortSignal),
  });
  expect(executor.mock.calls[0]?.[1]).not.toHaveProperty("tools");
  expect(executor.mock.calls[0]?.[1]).not.toHaveProperty("runtimeContext");
  expect(child.tools).toEqual({ ownTool });
  expect(child.tools).not.toHaveProperty("parentOnlyTool");
});

it("propagates child failure through the ordinary Tool execute rejection with one child Work", async () => {
  const failure = new Error("child failed");
  const child = agent({ id: "child", description: "child", prompt: prompt({ prompt: () => "child" }) });
  const executor = vi.fn<AgentExecutor>().mockRejectedValue(failure);
  const kernel = createProcessLocalWorkKernel();
  const handles: Array<{ result(): Promise<unknown>; status(): Promise<{ state: string }> }> = [];
  const spawn = vi.fn<ForegroundChildWorkPort["spawn"]>(async (run, options) => {
    const handle = await kernel.spawn({ run: ({ signal }) => run(signal) }, options);
    handles.push(handle);
    return handle;
  });

  await expect(boundChild(child, executor, { spawn }).execute({}, {
    toolCallId: "call", runtimeContext: undefined,
  })).rejects.toBe(failure);
  expect(spawn).toHaveBeenCalledOnce();
  expect(executor).toHaveBeenCalledOnce();
  await expect(handles[0]?.status()).resolves.toMatchObject({ state: "failed" });
});

it("propagates an inherited parent abort through one failed child Work", async () => {
  const parent = new AbortController();
  const failure = new Error("parent aborted");
  parent.abort(failure);
  const child = agent({ id: "child", description: "child", prompt: prompt({ prompt: () => "child" }) });
  const executor = vi.fn<AgentExecutor>(async (_child, options) => {
    if (options.signal?.aborted) throw options.signal.reason;
    return { agentId: "child", output: "done", durationMs: 1 };
  });
  const kernel = createProcessLocalWorkKernel();
  const handles: Array<{ status(): Promise<{ state: string }> }> = [];
  const spawn = vi.fn<ForegroundChildWorkPort["spawn"]>(async (run, options) => {
    const handle = await kernel.spawn({ run: ({ signal }) => run(signal) }, options);
    handles.push(handle);
    return handle;
  });

  await expect(boundChild(child, executor, { spawn }).execute({}, {
    toolCallId: "call", runtimeContext: undefined, abortSignal: parent.signal,
  })).rejects.toBe(failure);
  expect(spawn).toHaveBeenCalledWith(expect.any(Function), {
    kind: "cancellation-only", signal: parent.signal,
  });
  await expect(handles[0]?.status()).resolves.toMatchObject({ state: "failed" });
});
