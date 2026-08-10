import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "../../src";
import { agent } from "../../src/agent";
import type { AgentExecutor } from "../../src/agent/executor";
import { createProcessLocalAgentWorkController } from "../../src/work/internal/agent-work-controller";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";

describe("process-local Agent Work retention", () => {
  it("starts exactly one child under concurrent first accept and reconnects both callers", async () => {
    let starts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const child = agent({
      id: "race-child",
      description: "Concurrent first accept",
      prompt: prompt({
        id: "race-child-prompt",
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => input.topic,
      }),
    });
    const executor: AgentExecutor = async () => {
      starts += 1;
      await gate;
      return { agentId: "race-child", output: "ok", durationMs: 1 };
    };
    const controller = createProcessLocalAgentWorkController({
      kernel: createProcessLocalWorkKernel(),
    });
    const occurrence = {
      ownerId: "owner_exec_race",
      turnId: "hist:0",
      toolCallId: "stable-call",
      bindingKey: "research",
    };

    const [first, second] = await Promise.all([
      controller.spawnAgent(child, { topic: "same" }, { executor, occurrence }),
      controller.spawnAgent(child, { topic: "same" }, { executor, occurrence }),
    ]);

    expect(first.id).toBe(second.id);
    expect(starts).toBe(1);
    release();
    await expect(first.result()).resolves.toBe("ok");
    await expect(second.result()).resolves.toBe("ok");
    expect(starts).toBe(1);
  });

  it("drops raw steering on terminal, keeps record for in-turn replay, then cleans up on owner release", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const child = agent({
      id: "retain-child",
      description: "Retention child",
      prompt: prompt({
        id: "retain-child-prompt",
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => input.topic,
      }),
    });
    const executor: AgentExecutor = async (_agent, options) => {
      await gate;
      const steered = (await options.projectStepMessages?.()) ?? [];
      expect(steered).toHaveLength(1);
      return { agentId: "retain-child", output: "done", durationMs: 1 };
    };
    const controller = createProcessLocalAgentWorkController({
      kernel: createProcessLocalWorkKernel(),
    });
    const ownerId = "owner_exec_retain";
    const occurrence = {
      ownerId,
      turnId: "hist:1",
      toolCallId: "call_1",
      bindingKey: "research",
    };

    const handle = await controller.spawnAgent(
      child,
      { topic: "x" },
      { executor, occurrence },
    );
    await handle.send("guidance");
    expect(controller.recordCount()).toBe(1);
    expect(controller.occurrences.get(occurrence)?.workId).toBe(handle.id);

    release();
    await expect(handle.result()).resolves.toBe("done");
    // Terminal settlement keeps the record so same-turn replay can rejoin.
    await vi.waitFor(() => {
      expect(controller.isAgentWork(handle.id)).toBe(true);
    });
    expect(controller.recordCount()).toBe(1);
    expect(controller.occurrences.get(occurrence)?.workId).toBe(handle.id);

    // Parent execution end releases occurrence and disposes terminal records.
    controller.releaseOwner(ownerId);
    await vi.waitFor(() => {
      expect(controller.recordCount()).toBe(0);
    });
    expect(controller.occurrences.get(occurrence)).toBeUndefined();
    expect(controller.isAgentWork(handle.id)).toBe(false);
  });

  it("releases owner occurrence entries at parent end while live children remain joinable", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const child = agent({
      id: "live-child",
      description: "Still running after parent release",
      prompt: prompt({
        id: "live-child-prompt",
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => input.topic,
      }),
    });
    const executor: AgentExecutor = async () => {
      await gate;
      return { agentId: "live-child", output: "later", durationMs: 1 };
    };
    const controller = createProcessLocalAgentWorkController({
      kernel: createProcessLocalWorkKernel(),
    });
    const ownerId = "owner_exec_parent_end";
    const occurrence = {
      ownerId,
      turnId: "hist:0",
      toolCallId: "call_1",
      bindingKey: "research",
    };

    const handle = await controller.spawnAgent(
      child,
      { topic: "x" },
      { executor, occurrence },
    );
    expect(controller.recordCount()).toBe(1);

    controller.releaseOwner(ownerId);
    expect(controller.occurrences.get(occurrence)).toBeUndefined();
    // Live child remains joinable until it terminals.
    expect(controller.isAgentWork(handle.id)).toBe(true);
    expect(controller.recordCount()).toBe(1);

    release();
    await expect(handle.result()).resolves.toBe("later");
    await vi.waitFor(() => {
      expect(controller.recordCount()).toBe(0);
    });
  });
});
