import { describe, expect, it } from "vitest";
import { z } from "zod";
import { prompt } from "../../src";
import { agent } from "../../src/agent";
import type { AgentExecutor } from "../../src/agent/executor";
import { resolveWorkPolicy, workPolicy } from "../../src/work";
import { WorkAdmissionError } from "../../src/work/errors";
import { createProcessLocalAgentWorkController } from "../../src/work/internal/agent-work-controller";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";

describe("process-local Agent Work tree policy", () => {
  it("rejects an attached grandchild past maxDepth without running its executor", async () => {
    const resolvers = new Map<string, () => void>();
    let grandchildCalls = 0;

    const release = (label: string): void => {
      const resolve = resolvers.get(label);
      if (resolve) {
        resolve();
      }
    };

    const treeAgent = agent({
      id: "tree-agent",
      description: "Tree policy agent",
      prompt: prompt({
        id: "tree-agent-prompt",
        input: z.object({ label: z.string() }),
        prompt: ({ input }) => input.label,
      }),
    });

    const executor: AgentExecutor = async (_agent, options) => {
      const label = (options.input as { label: string }).label;

      if (label === "grandchild") {
        grandchildCalls += 1;
      }

      if (label === "root" || label === "child") {
        await new Promise<void>((resolve) => {
          resolvers.set(label, resolve);
        });
      }

      return { agentId: "tree-agent", output: label, durationMs: 1 };
    };

    const controller = createProcessLocalAgentWorkController({
      kernel: createProcessLocalWorkKernel(),
      policy: resolveWorkPolicy(workPolicy({ tree: { maxDepth: 1 } })),
    });

    const root = await controller.spawnAgent(
      treeAgent,
      { label: "root" },
      { executor },
    );

    const child = await controller.spawnAgent(
      treeAgent,
      { label: "child" },
      {
        executor,
        spawn: {
          kind: "attached",
          attachment: {
            parentId: root.id,
            signal: new AbortController().signal,
          },
        },
      },
    );

    const grandchild = controller.spawnAgent(
      treeAgent,
      { label: "grandchild" },
      {
        executor,
        spawn: {
          kind: "attached",
          attachment: {
            parentId: child.id,
            signal: new AbortController().signal,
          },
        },
      },
    );

    await expect(grandchild).rejects.toBeInstanceOf(WorkAdmissionError);
    await expect(grandchild).rejects.toMatchObject({
      code: "work_admission_max_depth",
      category: "topology",
      retryable: false,
    });
    expect(grandchildCalls).toBe(0);

    release("child");
    await expect(child.result()).resolves.toBe("child");

    release("root");
    await expect(root.result()).resolves.toBe("root");
  });

  it("rejects an attached second child past maxStarts without running its executor", async () => {
    const resolvers = new Map<string, () => void>();
    let secondChildCalls = 0;

    const release = (label: string): void => {
      const resolve = resolvers.get(label);
      if (resolve) {
        resolve();
      }
    };

    const treeAgent = agent({
      id: "tree-agent",
      description: "Tree policy agent",
      prompt: prompt({
        id: "tree-agent-prompt",
        input: z.object({ label: z.string() }),
        prompt: ({ input }) => input.label,
      }),
    });

    const executor: AgentExecutor = async (_agent, options) => {
      const label = (options.input as { label: string }).label;

      if (label === "second-child") {
        secondChildCalls += 1;
      }

      if (label === "root") {
        await new Promise<void>((resolve) => {
          resolvers.set(label, resolve);
        });
      }

      return { agentId: "tree-agent", output: label, durationMs: 1 };
    };

    const controller = createProcessLocalAgentWorkController({
      kernel: createProcessLocalWorkKernel(),
      policy: resolveWorkPolicy(
        workPolicy({ tree: { maxDepth: 2, maxStarts: 1, maxActive: 4 } }),
      ),
    });

    const root = await controller.spawnAgent(
      treeAgent,
      { label: "root" },
      { executor },
    );

    const firstChild = await controller.spawnAgent(
      treeAgent,
      { label: "first-child" },
      {
        executor,
        spawn: {
          kind: "attached",
          attachment: {
            parentId: root.id,
            signal: new AbortController().signal,
          },
        },
      },
    );

    await expect(firstChild.result()).resolves.toBe("first-child");

    const secondChild = controller.spawnAgent(
      treeAgent,
      { label: "second-child" },
      {
        executor,
        spawn: {
          kind: "attached",
          attachment: {
            parentId: root.id,
            signal: new AbortController().signal,
          },
        },
      },
    );

    await expect(secondChild).rejects.toBeInstanceOf(WorkAdmissionError);
    await expect(secondChild).rejects.toMatchObject({
      code: "work_admission_max_starts",
      category: "lifetime",
      retryable: false,
    });
    expect(secondChildCalls).toBe(0);

    release("root");
    await expect(root.result()).resolves.toBe("root");
  });

  it("rejects an attached second child past maxActive without running its executor", async () => {
    const resolvers = new Map<string, () => void>();
    let secondChildCalls = 0;

    const release = (label: string): void => {
      const resolve = resolvers.get(label);
      if (resolve) {
        resolve();
      }
    };

    const treeAgent = agent({
      id: "tree-agent",
      description: "Tree policy agent",
      prompt: prompt({
        id: "tree-agent-prompt",
        input: z.object({ label: z.string() }),
        prompt: ({ input }) => input.label,
      }),
    });

    const executor: AgentExecutor = async (_agent, options) => {
      const label = (options.input as { label: string }).label;

      if (label === "second-child") {
        secondChildCalls += 1;
      }

      if (label === "root" || label === "first-child") {
        await new Promise<void>((resolve) => {
          resolvers.set(label, resolve);
        });
      }

      return { agentId: "tree-agent", output: label, durationMs: 1 };
    };

    const controller = createProcessLocalAgentWorkController({
      kernel: createProcessLocalWorkKernel(),
      policy: resolveWorkPolicy(
        workPolicy({ tree: { maxDepth: 2, maxStarts: 4, maxActive: 1 } }),
      ),
    });

    const root = await controller.spawnAgent(
      treeAgent,
      { label: "root" },
      { executor },
    );

    const firstChild = await controller.spawnAgent(
      treeAgent,
      { label: "first-child" },
      {
        executor,
        spawn: {
          kind: "attached",
          attachment: {
            parentId: root.id,
            signal: new AbortController().signal,
          },
        },
      },
    );

    const secondChild = controller.spawnAgent(
      treeAgent,
      { label: "second-child" },
      {
        executor,
        spawn: {
          kind: "attached",
          attachment: {
            parentId: root.id,
            signal: new AbortController().signal,
          },
        },
      },
    );

    await expect(secondChild).rejects.toBeInstanceOf(WorkAdmissionError);
    await expect(secondChild).rejects.toMatchObject({
      code: "work_admission_max_active",
      category: "capacity",
      retryable: true,
    });
    expect(secondChildCalls).toBe(0);

    release("first-child");
    await expect(firstChild.result()).resolves.toBe("first-child");

    const retriedSecondChild = await controller.spawnAgent(
      treeAgent,
      { label: "second-child" },
      {
        executor,
        spawn: {
          kind: "attached",
          attachment: {
            parentId: root.id,
            signal: new AbortController().signal,
          },
        },
      },
    );

    await expect(retriedSecondChild.result()).resolves.toBe("second-child");

    release("root");
    await expect(root.result()).resolves.toBe("root");
  });

  it("does not release root maxActive when detaching a running child", async () => {
    const resolvers = new Map<string, () => void>();
    let secondChildCalls = 0;

    const release = (label: string): void => {
      const resolve = resolvers.get(label);
      if (resolve) {
        resolve();
      }
    };

    const treeAgent = agent({
      id: "tree-agent",
      description: "Tree policy agent",
      prompt: prompt({
        id: "tree-agent-prompt",
        input: z.object({ label: z.string() }),
        prompt: ({ input }) => input.label,
      }),
    });

    const executor: AgentExecutor = async (_agent, options) => {
      const label = (options.input as { label: string }).label;

      if (label === "second-child") {
        secondChildCalls += 1;
      }

      if (label === "root" || label === "first-child") {
        await new Promise<void>((resolve) => {
          resolvers.set(label, resolve);
        });
      }

      return { agentId: "tree-agent", output: label, durationMs: 1 };
    };

    const controller = createProcessLocalAgentWorkController({
      kernel: createProcessLocalWorkKernel(),
      policy: resolveWorkPolicy(
        workPolicy({ tree: { maxDepth: 2, maxStarts: 8, maxActive: 1 } }),
      ),
    });

    const root = await controller.spawnAgent(
      treeAgent,
      { label: "root" },
      { executor },
    );

    const firstChild = await controller.spawnAgent(
      treeAgent,
      { label: "first-child" },
      {
        executor,
        spawn: {
          kind: "attached",
          attachment: {
            parentId: root.id,
            signal: new AbortController().signal,
          },
        },
      },
    );

    await expect(firstChild.detach()).resolves.toMatchObject({
      outcome: "detached",
      ownership: { state: "detached", reason: "explicit" },
    });

    const secondChild = controller.spawnAgent(
      treeAgent,
      { label: "second-child" },
      {
        executor,
        spawn: {
          kind: "attached",
          attachment: {
            parentId: root.id,
            signal: new AbortController().signal,
          },
        },
      },
    );

    await expect(secondChild).rejects.toBeInstanceOf(WorkAdmissionError);
    await expect(secondChild).rejects.toMatchObject({
      code: "work_admission_max_active",
      category: "capacity",
      retryable: true,
    });
    expect(secondChildCalls).toBe(0);

    release("first-child");
    await expect(firstChild.result()).resolves.toBe("first-child");

    const retriedSecondChild = await controller.spawnAgent(
      treeAgent,
      { label: "second-child" },
      {
        executor,
        spawn: {
          kind: "attached",
          attachment: {
            parentId: root.id,
            signal: new AbortController().signal,
          },
        },
      },
    );

    await expect(retriedSecondChild.result()).resolves.toBe("second-child");

    release("root");
    await expect(root.result()).resolves.toBe("root");
  });

  it("reconnects an idempotent occurrence replay instead of rejecting it against maxStarts/maxActive", async () => {
    const resolvers = new Map<string, () => void>();
    let childCalls = 0;

    const release = (label: string): void => {
      const resolve = resolvers.get(label);
      if (resolve) {
        resolve();
      }
    };

    const treeAgent = agent({
      id: "tree-agent",
      description: "Tree policy agent",
      prompt: prompt({
        id: "tree-agent-prompt",
        input: z.object({ label: z.string() }),
        prompt: ({ input }) => input.label,
      }),
    });

    const executor: AgentExecutor = async (_agent, options) => {
      const label = (options.input as { label: string }).label;

      if (label === "child") {
        childCalls += 1;
      }

      if (label === "root" || label === "child") {
        await new Promise<void>((resolve) => {
          resolvers.set(label, resolve);
        });
      }

      return { agentId: "tree-agent", output: label, durationMs: 1 };
    };

    const controller = createProcessLocalAgentWorkController({
      kernel: createProcessLocalWorkKernel(),
      policy: resolveWorkPolicy(
        workPolicy({ tree: { maxDepth: 2, maxStarts: 1, maxActive: 1 } }),
      ),
    });

    const root = await controller.spawnAgent(
      treeAgent,
      { label: "root" },
      { executor },
    );

    const childOccurrence = Object.freeze({
      ownerId: "root-owner",
      turnId: "turn-1",
      toolCallId: "call-1",
      bindingKey: "child",
    });

    const child = await controller.spawnAgent(
      treeAgent,
      { label: "child" },
      {
        executor,
        occurrence: childOccurrence,
        spawn: {
          kind: "attached",
          attachment: {
            parentId: root.id,
            signal: new AbortController().signal,
          },
        },
      },
    );

    const replay = await controller.spawnAgent(
      treeAgent,
      { label: "child" },
      {
        executor,
        occurrence: childOccurrence,
        spawn: {
          kind: "attached",
          attachment: {
            parentId: root.id,
            signal: new AbortController().signal,
          },
        },
      },
    );

    expect(replay.id).toBe(child.id);
    expect(childCalls).toBe(1);

    release("child");
    await expect(child.result()).resolves.toBe("child");

    release("root");
    await expect(root.result()).resolves.toBe("root");
  });
});
