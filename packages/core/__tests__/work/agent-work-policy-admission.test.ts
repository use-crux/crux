import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "../../src";
import { agent } from "../../src/agent";
import type { AgentExecutor } from "../../src/agent/executor";
import {
  createAgentWorkHost,
  resolveWorkPolicy,
  spawn,
  workPolicy,
} from "../../src/work";
import { WorkAdmissionError } from "../../src/work/errors";

describe("process-local Agent Work policy admission", () => {
  it("applies finite exported defaults when no authored policy is supplied", () => {
    const defaults = resolveWorkPolicy();

    expect(defaults).toEqual({
      concurrency: 8,
      maxOutstanding: 32,
      tree: { maxDepth: 4, maxStarts: 64, maxActive: 16 },
    });
    expect(Object.isFrozen(defaults)).toBe(true);
    expect(Object.isFrozen(defaults.tree)).toBe(true);

    const host = createAgentWorkHost({
      executor: async () => ({
        agentId: "default-host",
        output: "ok",
        durationMs: 1,
      }),
    });

    expect(host.policy).toEqual(defaults);
    expect(Object.isFrozen(host.policy)).toBe(true);
    expect(Object.isFrozen(host.policy.tree)).toBe(true);
  });

  it("enforces a narrow host policy: concurrency caps simultaneous execution, overflow stays queued FIFO, and spawn beyond maxOutstanding rejects before the executor runs", async () => {
    const started: string[] = [];
    let concurrent = 0;
    let peak = 0;
    let executorCalls = 0;
    const gates = new Map<string, () => void>();

    const child = agent({
      id: "policy-child",
      description: "Admission child",
      prompt: prompt({
        id: "policy-child-prompt",
        input: z.object({ task: z.string() }),
        prompt: ({ input }) => input.task,
      }),
    });

    const executor: AgentExecutor = async (_agent, options) => {
      const task = (options.input as { task: string }).task;
      executorCalls += 1;
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      started.push(task);
      await new Promise<void>((resolve) => {
        gates.set(task, resolve);
      });
      concurrent -= 1;
      return { agentId: "policy-child", output: `done:${task}`, durationMs: 1 };
    };

    const host = createAgentWorkHost({
      executor,
      policy: workPolicy({ concurrency: 2, maxOutstanding: 4 }),
    });

    expect(host.policy).toEqual(
      resolveWorkPolicy(workPolicy({ concurrency: 2, maxOutstanding: 4 })),
    );

    const first = await host.run(() => spawn(child, { task: "first" }));
    const second = await host.run(() => spawn(child, { task: "second" }));
    const third = await host.run(() => spawn(child, { task: "third" }));
    const fourth = await host.run(() => spawn(child, { task: "fourth" }));

    await vi.waitFor(() => {
      expect(executorCalls).toBe(2);
      expect(peak).toBe(2);
    });
    await expect(first.status()).resolves.toMatchObject({ state: "running" });
    await expect(second.status()).resolves.toMatchObject({ state: "running" });
    await expect(third.status()).resolves.toMatchObject({ state: "queued" });
    await expect(fourth.status()).resolves.toMatchObject({ state: "queued" });
    expect(started).toEqual(["first", "second"]);

    const overflow = host.run(() => spawn(child, { task: "overflow" }));
    await expect(overflow).rejects.toBeInstanceOf(WorkAdmissionError);
    await expect(overflow).rejects.toMatchObject({
      code: "work_admission_max_outstanding",
      retryable: true,
      category: "capacity",
    });
    expect(executorCalls).toBe(2);
    expect(started).toEqual(["first", "second"]);

    gates.get("first")!();
    await vi.waitFor(() => {
      expect(started).toEqual(["first", "second", "third"]);
    });
    expect(peak).toBe(2);

    gates.get("second")!();
    await vi.waitFor(() => {
      expect(started).toEqual(["first", "second", "third", "fourth"]);
    });
    expect(peak).toBe(2);

    gates.get("third")!();
    gates.get("fourth")!();
    await expect(
      Promise.all([
        first.result(),
        second.result(),
        third.result(),
        fourth.result(),
      ]),
    ).resolves.toEqual([
      "done:first",
      "done:second",
      "done:third",
      "done:fourth",
    ]);
  });

  it("skips cancelled queued work without leaking admission capacity", async () => {
    const started: string[] = [];
    let concurrent = 0;
    let peak = 0;
    let executorCalls = 0;
    const gates = new Map<string, () => void>();

    const child = agent({
      id: "cancel-policy-child",
      description: "Cancelled admission child",
      prompt: prompt({
        id: "cancel-policy-child-prompt",
        input: z.object({ task: z.string() }),
        prompt: ({ input }) => input.task,
      }),
    });

    const executor: AgentExecutor = async (_agent, options) => {
      const task = (options.input as { task: string }).task;
      executorCalls += 1;
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      started.push(task);
      await new Promise<void>((resolve) => {
        gates.set(task, resolve);
      });
      concurrent -= 1;
      return {
        agentId: "cancel-policy-child",
        output: `done:${task}`,
        durationMs: 1,
      };
    };

    const host = createAgentWorkHost({
      executor,
      policy: workPolicy({ concurrency: 1, maxOutstanding: 3 }),
    });

    const first = await host.run(() => spawn(child, { task: "first" }));
    const second = await host.run(() => spawn(child, { task: "second" }));
    const third = await host.run(() => spawn(child, { task: "third" }));

    await vi.waitFor(() => {
      expect(executorCalls).toBe(1);
      expect(peak).toBe(1);
    });
    expect(started).toEqual(["first"]);
    await expect(first.status()).resolves.toMatchObject({ state: "running" });
    await expect(second.status()).resolves.toMatchObject({ state: "queued" });
    await expect(third.status()).resolves.toMatchObject({ state: "queued" });

    await expect(
      second.cancel({ reason: "not needed" }),
    ).resolves.toMatchObject({
      outcome: "cancelled",
    });
    await expect(second.status()).resolves.toMatchObject({
      state: "cancelled",
    });
    expect(executorCalls).toBe(1);
    expect(started).toEqual(["first"]);

    gates.get("first")!();
    await vi.waitFor(() => {
      expect(started).toEqual(["first", "third"]);
    });
    expect(executorCalls).toBe(2);
    expect(peak).toBe(1);

    gates.get("third")!();

    const fourth = await host.run(() => spawn(child, { task: "fourth" }));
    await vi.waitFor(() => {
      expect(started).toEqual(["first", "third", "fourth"]);
    });
    expect(executorCalls).toBe(3);
    expect(peak).toBe(1);

    gates.get("fourth")!();

    await expect(
      Promise.all([first.result(), third.result(), fourth.result()]),
    ).resolves.toEqual(["done:first", "done:third", "done:fourth"]);
    await expect(second.result()).rejects.toMatchObject({
      code: "work_cancelled",
    });
  });

  it("detach releases owner outstanding without releasing execution or concurrency", async () => {
    const started: string[] = [];
    let executorCalls = 0;

    function deferred() {
      let release: (() => void) | undefined;
      const opened = new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        opened,
        release: () => {
          if (release) {
            release();
          }
        },
      };
    }

    const gates = new Map<string, ReturnType<typeof deferred>>([
      ["first", deferred()],
      ["second", deferred()],
    ]);

    const child = agent({
      id: "detach-policy-child",
      description: "Detached admission child",
      prompt: prompt({
        id: "detach-policy-child-prompt",
        input: z.object({ task: z.string() }),
        prompt: ({ input }) => input.task,
      }),
    });

    const executor: AgentExecutor = async (_agent, options) => {
      const task = (options.input as { task: string }).task;
      executorCalls += 1;
      started.push(task);
      const current = gates.get(task);
      if (current) {
        await current.opened;
      }
      return {
        agentId: "detach-policy-child",
        output: `done:${task}`,
        durationMs: 1,
      };
    };

    const host = createAgentWorkHost({
      executor,
      policy: workPolicy({ concurrency: 1, maxOutstanding: 1 }),
    });

    const first = await host.run(() => spawn(child, { task: "first" }));

    await vi.waitFor(() => {
      expect(executorCalls).toBe(1);
    });
    expect(started).toEqual(["first"]);
    await expect(first.status()).resolves.toMatchObject({ state: "running" });

    await expect(first.detach()).resolves.toMatchObject({
      outcome: "detached",
      ownership: { state: "detached", reason: "explicit" },
    });
    await expect(first.status()).resolves.toMatchObject({
      state: "running",
      ownership: { state: "detached", reason: "explicit" },
    });

    const second = await host.run(() => spawn(child, { task: "second" }));
    expect(executorCalls).toBe(1);
    expect(started).toEqual(["first"]);
    await expect(second.status()).resolves.toMatchObject({ state: "queued" });

    gates.get("first")?.release();
    await vi.waitFor(() => {
      expect(started).toEqual(["first", "second"]);
    });
    expect(executorCalls).toBe(2);
    await expect(second.status()).resolves.toMatchObject({ state: "running" });

    gates.get("second")?.release();

    await expect(first.result()).resolves.toBe("done:first");
    await expect(second.result()).resolves.toBe("done:second");
  });
});
