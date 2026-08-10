import { expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "../../src";
import { agent } from "../../src/agent";
import type { AgentExecutor } from "../../src/agent/executor";
import { bindForegroundAgentTools } from "../../src/agent/foreground-tool-binder";
import type { ToolExecutionOptions } from "../../src/types/tool";
import { createProcessLocalAgentWorkController } from "../../src/work/internal/agent-work-controller";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";

function boundChild(child: ReturnType<typeof agent>, executor: AgentExecutor) {
  const kernel = createProcessLocalWorkKernel();
  const agentWork = createProcessLocalAgentWorkController({ kernel });
  const tools = bindForegroundAgentTools(
    { child },
    {
      executor,
      model: "model",
      agentWork,
      ownerId: "owner_exec_parent",
    },
  );
  return tools.child as {
    execute(input: unknown, options: ToolExecutionOptions): Promise<unknown>;
  };
}

it("passes a child only its declared input and own Agent definition", async () => {
  const ownTool = { description: "own", execute: () => "own" };
  const parentOnlyTool = { description: "parent", execute: () => "parent" };
  const child = agent({
    id: "child",
    description: "child",
    prompt: prompt({
      input: z.object({ request: z.string() }),
      prompt: () => "child",
    }),
    tools: { ownTool },
  });
  const executor = vi.fn<AgentExecutor>().mockResolvedValue({
    agentId: "child",
    output: { answer: "exact" },
    durationMs: 1,
  });

  const result = await boundChild(child, executor).execute(
    { request: "declared" },
    { toolCallId: "call", runtimeContext: { parentOnlyTool } },
  );

  expect(result).toEqual({ answer: "exact" });
  expect(executor).toHaveBeenCalledWith(
    child,
    expect.objectContaining({
      input: { request: "declared" },
      model: "model",
      signal: expect.any(AbortSignal),
    }),
  );
  expect(executor.mock.calls[0]?.[1]).not.toHaveProperty("tools");
  expect(executor.mock.calls[0]?.[1]).not.toHaveProperty("runtimeContext");
  expect(child.tools).toEqual({ ownTool });
  expect(child.tools).not.toHaveProperty("parentOnlyTool");
});

it("propagates child failure through the ordinary Tool execute rejection with one child Work", async () => {
  const failure = new Error("child failed");
  const child = agent({
    id: "child",
    description: "child",
    prompt: prompt({ prompt: () => "child" }),
  });
  const executor = vi.fn<AgentExecutor>().mockRejectedValue(failure);

  await expect(
    boundChild(child, executor).execute(
      {},
      { toolCallId: "call", runtimeContext: undefined },
    ),
  ).rejects.toMatchObject({
    workId: expect.any(String),
    code: "work_failed",
  });
  expect(executor).toHaveBeenCalledOnce();
});

it("propagates an inherited parent abort through one failed child Work", async () => {
  const parent = new AbortController();
  const failure = new Error("parent aborted");
  parent.abort(failure);
  const child = agent({
    id: "child",
    description: "child",
    prompt: prompt({ prompt: () => "child" }),
  });
  const executor = vi.fn<AgentExecutor>(async (_child, options) => {
    if (options.signal?.aborted) {
      throw options.signal.reason;
    }
    return { agentId: "child", output: "done", durationMs: 1 };
  });

  await expect(
    boundChild(child, executor).execute(
      {},
      {
        toolCallId: "call",
        runtimeContext: undefined,
        abortSignal: parent.signal,
      },
    ),
  ).rejects.toMatchObject({
    workId: expect.any(String),
    code: "work_failed",
  });
  expect(executor).toHaveBeenCalledOnce();
});
