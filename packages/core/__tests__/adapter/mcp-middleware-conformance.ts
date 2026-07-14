import { mcp, stdio } from "@use-crux/mcp";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { prompt } from "../../src/prompt/prompt";
import { toolMiddleware } from "../../src/tools/middleware";
import { createMcpPolicyFixture } from "./mcp-policy-fixture";

/** Registers MCP cases shared by the ordinary authored-tool middleware path. */
export function registerMcpMiddlewareConformanceTests(): void {
  it("matches the exposed name and keeps call middleware outermost", async () => {
    const events: string[] = [];
    const execute = vi.fn(async (input: { value: string }) => {
      events.push(`transport:${input.value}`);
      return { value: input.value };
    });
    const source = mcp({
      id: "policy-fixture",
      transport: stdio({ command: "fixture-server" }),
      tools: { prefix: "server_" },
    });
    const assistant = prompt({
      id: "mcp-middleware-order",
      use: [source],
      prompt: "Use the exposed tool.",
      toolMiddleware: rewriteMiddleware("prompt", "P", events),
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        server_lookup: {
          description: "Look up a value.",
          parameters: z.object({ value: z.string() }),
          execute,
        },
      },
      toolName: "server_lookup",
      input: { value: "x" },
    });

    await fixture.adapter.generate(assistant, {
      model: "fixture-model",
      toolMiddleware: rewriteMiddleware("call", "C", events),
    });

    expect(events).toEqual([
      "call:server_lookup",
      "prompt:server_lookup",
      "transport:xCP",
    ]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("runs after hooks with the materialized tool result", async () => {
    const afterExecute = vi.fn();
    const source = mcp({
      id: "after-hook-fixture",
      transport: stdio({ command: "fixture-server" }),
    });
    const assistant = prompt({
      id: "mcp-after-hook",
      use: [source],
      prompt: "Use the tool.",
      toolMiddleware: toolMiddleware({
        id: "after-hook",
        match: ["lookup"],
        afterExecute,
      }),
    });
    const fixture = createMcpPolicyFixture({
      tools: {
        lookup: {
          description: "Look up a value.",
          parameters: z.object({ value: z.string() }),
          execute: async ({ value }: { value: string }) => ({ value }),
        },
      },
      toolName: "lookup",
      input: { value: "found" },
    });

    await fixture.adapter.generate(assistant, { model: "fixture-model" });

    expect(afterExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "lookup",
        toolCallId: "mcp-call-1",
        output: { value: "found" },
      }),
    );
  });

  it("routes materialized tool failures through middleware error hooks", async () => {
    const onError = vi.fn();
    const source = mcp({
      id: "error-hook-fixture",
      transport: stdio({ command: "fixture-server" }),
    });
    const assistant = prompt({
      id: "mcp-error-hook",
      use: [source],
      prompt: "Use the tool.",
      toolMiddleware: toolMiddleware({
        id: "error-hook",
        match: ["lookup"],
        onError,
      }),
    });
    const failure = new Error("fixture transport failed");
    const fixture = createMcpPolicyFixture({
      tools: {
        lookup: {
          description: "Look up a value.",
          parameters: z.object({ value: z.string() }),
          execute: async () => {
            throw failure;
          },
        },
      },
      toolName: "lookup",
      input: { value: "missing" },
    });

    await fixture.adapter.generate(assistant, { model: "fixture-model" });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "lookup",
        toolCallId: "mcp-call-1",
        error: failure,
      }),
    );
  });
}

function rewriteMiddleware(id: string, suffix: string, events: string[]) {
  return toolMiddleware({
    id,
    match: ["server_lookup"],
    aroundExecute: (call, next) => {
      events.push(`${id}:${call.toolName}`);
      const input = z.object({ value: z.string() }).parse(call.input);
      return next({ value: `${input.value}${suffix}` }, call.options);
    },
  });
}
