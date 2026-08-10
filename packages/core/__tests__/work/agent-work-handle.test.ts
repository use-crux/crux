import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "../../src";
import { agent } from "../../src/agent";
import type { AgentExecutor } from "../../src/agent/executor";
import { createAgentWorkHost, spawn } from "../../src/work";
import { WorkNotActiveError } from "../../src/work/errors";

describe("process-local Agent Work handles", () => {
  it("spawns an Agent handle with send, result, and process-local lifecycle", async () => {
    const seen: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const researcher = agent({
      id: "researcher",
      description: "Research one topic",
      prompt: prompt({
        id: "researcher-prompt",
        input: z.object({ task: z.string() }),
        output: z.object({ findings: z.string() }),
        prompt: ({ input }) => input.task,
      }),
    });
    const executor: AgentExecutor = async (target, options) => {
      seen.push({
        agentId: target.id,
        input: options.input,
        hasSteeringHook: typeof options.projectStepMessages === "function",
      });
      await gate;
      const steered = (await options.projectStepMessages?.()) ?? [];
      seen.push({ steered });
      return {
        agentId: target.id,
        output: {
          findings: `done:${(options.input as { task: string }).task}`,
        },
        durationMs: 1,
      };
    };

    const host = createAgentWorkHost({ executor });
    const child = await host.run(() =>
      spawn(researcher, { task: "Investigate the regression." }),
    );

    expect(child.id).toMatch(/^work_/);
    expect(child.send).toBeTypeOf("function");
    expect(Object.keys(child)).toEqual(
      expect.arrayContaining([
        "id",
        "effects",
        "status",
        "result",
        "progress",
        "cancel",
        "detach",
        "stream",
        "stats",
        "send",
      ]),
    );

    await vi.waitFor(async () => {
      await expect(child.status()).resolves.toMatchObject({ state: "running" });
    });

    const receipt = await child.send("Also compare the last two releases.");
    expect(receipt.outcome).toBe("accepted");
    expect(receipt.cursor.value).toBe("1");
    expect(Object.isFrozen(receipt)).toBe(true);

    release();
    const report = await child.result();
    expect(report).toEqual({
      findings: "done:Investigate the regression.",
    });
    expect(seen[0]).toMatchObject({
      agentId: "researcher",
      input: { task: "Investigate the regression." },
      hasSteeringHook: true,
    });
    expect(seen[1]).toEqual({
      steered: [
        {
          role: "user",
          content: "Also compare the last two releases.",
          metadata: { provenance: "agent-steering" },
        },
      ],
    });

    await expect(child.send("Too late")).rejects.toBeInstanceOf(
      WorkNotActiveError,
    );
  });

  it("delivers accepted steering only through the next step-message claim", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const claims: unknown[] = [];
    const childAgent = agent({
      id: "steered-child",
      description: "Child with multi-step potential",
      prompt: prompt({
        id: "steered-child-prompt",
        input: z.object({ task: z.string() }),
        prompt: ({ input }) => input.task,
      }),
    });
    const executor: AgentExecutor = async (_agent, options) => {
      await gate;
      const first = (await options.projectStepMessages?.()) ?? [];
      claims.push(first);
      const second = (await options.projectStepMessages?.()) ?? [];
      claims.push(second);
      return {
        agentId: "steered-child",
        output: "done",
        durationMs: 1,
      };
    };

    const host = createAgentWorkHost({ executor });
    const handle = await host.run(() =>
      spawn(childAgent, { task: "start" }),
    );

    await handle.send("first guidance");
    await handle.send("second guidance");
    release();
    await expect(handle.result()).resolves.toBe("done");

    expect(claims[0]).toEqual([
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
    expect(claims[1]).toEqual([]);
  });
});
