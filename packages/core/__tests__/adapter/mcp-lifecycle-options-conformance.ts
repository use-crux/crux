import { mcp, stdio } from "@use-crux/mcp";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { prompt } from "../../src/prompt/prompt";
import { memory, memoryBlock } from "../../src/memory";
import { createMcpPolicyFixture } from "./mcp-policy-fixture";

/** Registers ordinary lifecycle-option cases for materialized MCP tools. */
export function registerMcpLifecycleOptionsConformanceTests(): void {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets an intentional call-site tool override a discovered MCP tool", async () => {
    const remoteExecute = vi.fn(async () => ({ owner: "remote" }));
    const localExecute = vi.fn(async () => ({ owner: "call-site" }));
    const assistant = prompt({
      id: "mcp-call-tool-override",
      use: [
        mcp({
          id: "call-tool-override-fixture",
          transport: stdio({ command: "fixture-server" }),
        }),
      ],
      prompt: "Use the tool.",
    });
    const fixture = createMcpPolicyFixture({
      tools: Object.fromEntries([
        [
          "__proto__",
          {
            description: "Remote lookup.",
            parameters: z.object({ id: z.string() }),
            execute: remoteExecute,
          },
        ],
      ]),
      toolName: "__proto__",
      input: { id: "record-1" },
    });

    await fixture.adapter.generate(assistant, {
      model: "fixture-model",
      tools: Object.fromEntries([
        [
          "__proto__",
          {
            description: "Call-site lookup.",
            parameters: z.object({ id: z.string() }),
            execute: localExecute,
          },
        ],
      ]),
    });

    expect(localExecute).toHaveBeenCalledOnce();
    expect(remoteExecute).not.toHaveBeenCalled();
    expect(fixture.results()).toEqual([
      expect.objectContaining({ output: { owner: "call-site" } }),
    ]);
  });

  it("applies a named per-tool timeout to a discovered MCP tool", async () => {
    vi.useFakeTimers();
    const assistant = prompt({
      id: "mcp-tool-timeout",
      use: [
        mcp({
          id: "tool-timeout-fixture",
          transport: stdio({ command: "fixture-server" }),
        }),
      ],
      prompt: "Use the tool.",
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        lookup: {
          description: "Hanging lookup.",
          parameters: z.object({}),
          execute: async () => new Promise<never>(() => {}),
        },
      },
      toolName: "lookup",
      input: {},
    });

    const result = fixture.adapter.generate(assistant, {
      model: "fixture-model",
      timeout: { toolMs: 1_000, tools: { lookup: 25 } },
    });
    const assertion = expect(result).rejects.toMatchObject({
      budget: "tool",
      limitMs: 25,
      toolName: "lookup",
    });

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
  });

  it("keeps discovered MCP execution inside the total call timeout", async () => {
    vi.useFakeTimers();
    const assistant = prompt({
      id: "mcp-total-timeout",
      use: [
        mcp({
          id: "total-timeout-fixture",
          transport: stdio({ command: "fixture-server" }),
        }),
      ],
      prompt: "Use the tool.",
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        lookup: {
          description: "Hanging lookup.",
          parameters: z.object({}),
          execute: async () => new Promise<never>(() => {}),
        },
      },
      toolName: "lookup",
      input: {},
    });

    const result = fixture.adapter.generate(assistant, {
      model: "fixture-model",
      timeout: { totalMs: 40 },
    });
    const assertion = expect(result).rejects.toMatchObject({
      budget: "total",
      limitMs: 40,
    });

    await vi.advanceTimersByTimeAsync(40);

    await assertion;
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("captures discovered MCP tool results in bound memory", async () => {
    const captureTurn = vi.fn(async () => {});
    const boundMemory = memory({
      id: "mcp-memory",
      namespace: "thread:1",
      capture: { mode: "inline" },
      blocks: [
        memoryBlock({
          id: "turns",
          captureTurn,
        }),
      ],
    });
    const assistant = prompt({
      id: "mcp-memory-capture",
      use: [
        boundMemory,
        mcp({
          id: "memory-capture-fixture",
          transport: stdio({ command: "fixture-server" }),
        }),
      ],
      prompt: "Use the tool.",
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        lookup: {
          description: "Look up a record.",
          parameters: z.object({ id: z.string() }),
          execute: async ({ id }: { id: string }) => ({ id, status: "found" }),
        },
      },
      toolName: "lookup",
      input: { id: "record-1" },
    });

    await fixture.adapter.generate(assistant, { model: "fixture-model" });

    expect(captureTurn).toHaveBeenCalledOnce();
    expect(captureTurn.mock.calls[0]?.[0].toolEvents).toEqual([
      {
        toolCallId: "mcp-call-1",
        toolName: "lookup",
        args: { id: "record-1" },
        result: { id: "record-1", status: "found" },
      },
    ]);
  });
}
