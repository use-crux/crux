import { expect, it, vi } from "vitest";
import { z } from "zod";
import {
  adapter,
  prompt,
  type AdapterResponse,
  type AdapterSpec,
  type ToolResultEntry,
} from "../../src";
import { agent, backgroundable } from "../../src/agent";

function response(
  text: string,
  toolCalls?: Array<{ id: string; name: string; args: unknown }>,
): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: undefined,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

it("adds one bounded owner-scoped work control Tool for backgroundable children", async () => {
  const child = agent({
    id: "work-control-child",
    model: "child-model",
    description: "Run one child task",
    prompt: prompt({
      id: "work-control-child-prompt",
      input: z.object({ task: z.string() }),
      prompt: ({ input }) => input.task,
    }),
  });
  const parent = agent({
    id: "work-control-parent",
    prompt: prompt({ id: "work-control-parent-prompt", prompt: () => "parent" }),
    tools: {
      first: backgroundable(child),
      second: backgroundable(child),
    },
  });

  let finishDetached!: () => void;
  const detachedGate = new Promise<void>((resolve) => {
    finishDetached = resolve;
  });
  let childCalls = 0;
  let cancelledSignal: AbortSignal | undefined;
  let detachedSignal: AbortSignal | undefined;
  let detachedFinished = false;
  const workIds: string[] = [];
  const spawnedRefs = new Map<string, unknown>();
  const actionOutputs = new Map<string, unknown>();
  let parentCalls = 0;

  const spec: AdapterSpec<object, object> = {
    providerId: "work-control-recording",
    async call(_client, args, context) {
      if (args.model === "child-model") {
        const index = childCalls++;
        if (index === 0) {
          cancelledSignal = context?.signal;
          return await new Promise((_, reject) => {
            context?.signal?.addEventListener(
              "abort",
              () => reject(context.signal?.reason ?? new Error("cancelled")),
              { once: true },
            );
          });
        }
        if (index === 1) {
          detachedSignal = context?.signal;
          await detachedGate;
          detachedFinished = true;
        }
        return { raw: {}, extracted: response("exact child result") };
      }

      parentCalls += 1;
      if (parentCalls === 1) {
        expect(args.tools?.map((tool) => tool.name)).toEqual([
          "first",
          "second",
          "work",
        ]);
        expect(args.tools?.filter((tool) => tool.name === "work")).toHaveLength(1);
        expect(args.tools?.find((tool) => tool.name === "work")?.parameters)
          .toMatchObject({
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["list", "status", "result", "cancel", "detach", "send"],
              },
              id: { type: "string" },
              timeout: { type: "string" },
              message: { type: "string" },
            },
            required: ["action"],
          });
        return {
          raw: {},
          extracted: response(
            "",
            Array.from({ length: 51 }, (_, index) => ({
              id: `spawn-${index}`,
              name: index % 2 === 0 ? "first" : "second",
              args: { task: `task-${index}`, run_in_background: true },
            })),
          ),
        };
      }

      const workCall = (
        id: string,
        action: string,
        extra: Record<string, unknown> = {},
      ) => ({ id, name: "work", args: { action, ...extra } });
      const steps = [
        workCall("list", "list"),
        workCall("status", "status", { id: workIds[0] }),
        workCall("wait", "result", { id: workIds[0], timeout: "1ms" }),
        workCall("cancel", "cancel", { id: workIds[0] }),
        workCall("detach", "detach", { id: workIds[1] }),
        workCall("result", "result", { id: workIds[2] }),
        workCall("missing", "status", { id: workIds[1] }),
      ];
      const toolCall = steps[parentCalls - 2];
      return toolCall
        ? { raw: {}, extracted: response("", [toolCall]) }
        : { raw: {}, extracted: response("parent finished") };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound(messages, _assistant, results: ToolResultEntry[]) {
      for (const result of results) {
        if (result.name !== "work") {
          if (isRecord(result.output) && typeof result.output.id === "string") {
            workIds.push(result.output.id);
            spawnedRefs.set(result.toolCallId, result.output);
          }
          continue;
        }
        actionOutputs.set(result.toolCallId, result.output);
      }
      return messages;
    },
    mapSettings: () => ({}),
  };

  const result = await adapter(spec)({}).parallel({
    id: "work-control-tracer",
    context: {},
    agents: { parent },
    model: "parent-model",
  });

  expect(result.results.parent.output).toBe("parent finished");
  expect(workIds).toHaveLength(51);
  const listed = actionOutputs.get("list");
  expect(Array.isArray(listed)).toBe(true);
  expect(listed).toHaveLength(50);
  expect(Object.isFrozen(listed)).toBe(true);
  expect((listed as readonly unknown[]).every(Object.isFrozen)).toBe(true);
  expect(listed).toContainEqual(expect.objectContaining({
    targetLabel: "first",
    attachment: "attached",
    attempt: 1,
    work: expect.objectContaining({
      kind: "work.ref",
      id: workIds[0],
      targetId: "work-control-child",
      guarantees: {
        execution: "process-local",
        rejoin: "process-local",
      },
    }),
  }));
  expect(Object.isFrozen((listed as readonly Record<string, unknown>[])[0]?.work)).toBe(true);
  expect(spawnedRefs.get("spawn-0")).toEqual(expect.objectContaining({
    kind: "work.ref",
    targetId: "work-control-child",
  }));

  for (const action of ["status", "wait"] as const) {
    const output = actionOutputs.get(action);
    expect(output).toMatchObject({
      work: { id: workIds[0], targetId: "work-control-child" },
      attachment: "attached",
      attempt: 1,
    });
    expect(Object.isFrozen(output)).toBe(true);
    expect(JSON.stringify(output)).not.toContain("exact child result");
  }
  expect(actionOutputs.get("cancel")).toMatchObject({
    workId: workIds[0],
    accepted: true,
    state: "cancel-requested",
  });
  expect(Object.isFrozen(actionOutputs.get("cancel"))).toBe(true);
  expect(cancelledSignal?.aborted).toBe(true);
  expect(actionOutputs.get("detach")).toEqual({ id: workIds[1], detached: true });
  expect(actionOutputs.get("result")).toBe("exact child result");
  expect(actionOutputs.get("missing")).toEqual({ status: "not_found" });
  expect(detachedSignal?.aborted).toBe(false);
  expect(detachedFinished).toBe(false);

  finishDetached();
  await vi.waitFor(() => expect(detachedFinished).toBe(true));

  let plainProviderCalls = 0;
  const plain = agent({
    id: "plain-parent",
    prompt: prompt({ id: "plain-parent-prompt", prompt: () => "plain" }),
  });
  await adapter({
    ...spec,
    async call(_client, args) {
      plainProviderCalls += 1;
      expect(args.tools?.some((tool) => tool.name === "work") ?? false).toBe(false);
      return { raw: {}, extracted: response("plain finished") };
    },
  })({}).parallel({
    id: "plain-parent-run",
    context: {},
    agents: { plain },
    model: "parent-model",
  });
  expect(plainProviderCalls).toBe(1);

  const authoredWork = agent({
    id: "authored-work-parent",
    prompt: prompt({ id: "authored-work-prompt", prompt: () => "parent" }),
    tools: {
      child: backgroundable(child),
      work: {
        description: "Authored collision",
        parameters: z.object({}),
        execute: () => "authored",
      },
    },
  });
  await expect(adapter(spec)({}).parallel({
    id: "authored-work-collision",
    context: {},
    agents: { authoredWork },
    model: "parent-model",
  })).rejects.toThrow('Tool name "work" is reserved for background Work control.');
});

it("work.send accepts Agent children, rejects non-Agent targets, is idempotent, and rejects terminal Work", async () => {
  const { bindWorkControlTool, WORK_CONTROL_TOOL_NAME } = await import(
    "../../src/agent/work-control-tool"
  );
  const { createProcessLocalAgentWorkController } = await import(
    "../../src/work/internal/agent-work-controller"
  );
  const { createProcessLocalWorkKernel } = await import(
    "../../src/work/internal/process-local-kernel"
  );
  const { createInternalWorkOwnerPort } = await import(
    "../../src/work/internal/owner-retained-work"
  );
  const { WorkNotActiveError } = await import("../../src/work/errors");
  const { backgroundable: markBackgroundable } = await import(
    "../../src/agent"
  );

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const kernel = createProcessLocalWorkKernel();
  const agentWork = createProcessLocalAgentWorkController({ kernel });
  const owner = createInternalWorkOwnerPort(kernel);
  const child = agent({
    id: "send-behavior-child",
    description: "Agent child for work.send behavior",
    prompt: prompt({
      id: "send-behavior-child-prompt",
      input: z.object({ task: z.string() }),
      prompt: ({ input }) => input.task,
    }),
  });

  // Non-Agent retained Work: owner inbox only, not the Agent controller.
  const nonAgent = await owner.spawnAndRetain(
    {
      run: async () => {
        await gate;
        return "non-agent-result";
      },
    },
    {
      kind: "cancellation-only",
      targetId: "task",
      targetLabel: "task",
    },
  );

  const occurrence = {
    ownerId: "owner_exec_send_behavior",
    turnId: "hist:0",
    toolCallId: "spawn-1",
    bindingKey: "research",
  };
  const agentHandle = await agentWork.spawnAgent(
    child,
    { task: "run" },
    {
      occurrence,
      executor: async () => {
        await gate;
        return {
          agentId: "send-behavior-child",
          output: "agent-result",
          durationMs: 1,
        };
      },
    },
  );
  owner.retainExisting(agentWork.getInternal(agentHandle.id)!, {
    targetId: child.id,
    targetLabel: "research",
  });

  const tools = bindWorkControlTool(
    { research: markBackgroundable(child) },
    owner,
    agentWork,
  );
  const workTool = tools[WORK_CONTROL_TOOL_NAME] as {
    execute(
      input: unknown,
      options: { toolCallId: string; runtimeContext: unknown },
    ): Promise<unknown>;
  };

  const first = await workTool.execute(
    {
      action: "send",
      id: agentHandle.id,
      message: "Prioritize primary sources.",
    },
    { toolCallId: "send-1", runtimeContext: {} },
  );
  expect(first).toMatchObject({
    workId: agentHandle.id,
    outcome: "accepted",
    cursor: "1",
  });
  expect(Object.isFrozen(first)).toBe(true);

  // Same toolCallId is idempotent and does not allocate a second cursor.
  const replay = await workTool.execute(
    {
      action: "send",
      id: agentHandle.id,
      message: "Prioritize primary sources.",
    },
    { toolCallId: "send-1", runtimeContext: {} },
  );
  expect(replay).toMatchObject({
    workId: agentHandle.id,
    outcome: "accepted",
    cursor: "1",
  });

  await expect(
    workTool.execute(
      {
        action: "send",
        id: nonAgent.id,
        message: "not an Agent",
      },
      { toolCallId: "send-non-agent", runtimeContext: {} },
    ),
  ).rejects.toThrow(/only available for Agent Work/);

  release();
  await expect(agentHandle.result()).resolves.toBe("agent-result");
  await expect(
    workTool.execute(
      {
        action: "send",
        id: agentHandle.id,
        message: "too late",
      },
      { toolCallId: "send-late", runtimeContext: {} },
    ),
  ).rejects.toBeInstanceOf(WorkNotActiveError);
});
