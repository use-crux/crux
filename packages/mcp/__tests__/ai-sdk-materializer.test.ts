import { resetHooks, setHooks } from "@use-crux/core";
import type { ProjectIndexRuntimeUpdate } from "@use-crux/core/project-index/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mcp, streamableHttp } from "../src";
import { createAiSdkMcpClient } from "../src/ai-sdk/client";
import { materializeAiSdkMcpToolSource } from "../src/ai-sdk/materialize";

vi.mock("../src/ai-sdk/client", () => ({
  createAiSdkMcpClient: vi.fn(),
}));

const createClientMock = vi.mocked(createAiSdkMcpClient);

describe("AI SDK-native MCP client boundary", () => {
  beforeEach(() => {
    resetHooks();
    createClientMock.mockReset();
  });

  afterEach(() => {
    resetHooks();
  });

  it("uses native discovery and tool construction while preserving native model output", async () => {
    const runtimeUpdates: ProjectIndexRuntimeUpdate[] = [];
    setHooks({
      projectIndexRuntimeTransport: {
        enqueue(update) {
          runtimeUpdates.push(update);
        },
        async flush() {
          return "ok";
        },
      },
    });
    const nativeToModelOutput = vi.fn(({ output }: { output: unknown }) => ({
      type: "json",
      value: output,
    }));
    const nativeExecute = vi.fn(async () => ({
      content: [{ type: "text", text: "found", _meta: { secret: "hidden" } }],
      _meta: { secret: "hidden" },
    }));
    const listTools = vi.fn(async () => ({
      tools: [
        {
          name: "lookup",
          description: "Look up a record",
          inputSchema: {
            type: "object" as const,
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
    }));
    const toolsFromDefinitions = vi.fn(() => ({
      lookup: {
        description: "Look up a record",
        inputSchema: { jsonSchema: {} },
        execute: nativeExecute,
        toModelOutput: nativeToModelOutput,
      },
    }));
    const close = vi.fn(async () => {});
    createClientMock.mockResolvedValue({
      listTools,
      toolsFromDefinitions,
      close,
      serverInfo: { name: " native server ", version: " 2.0.0 " },
    } as never);

    const session = await materializeAiSdkMcpToolSource(
      mcp({
        id: "catalog",
        transport: streamableHttp({ url: "https://mcp.example.test" }),
      }),
      { runtimeContext: undefined },
    );
    const lookup = session.tools.lookup!;
    const output = await lookup.execute(
      { query: "crux" },
      { toolCallId: "call-1", runtimeContext: undefined },
    );

    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: expect.objectContaining({
          type: "http",
          redirect: "error",
        }),
      }),
    );
    expect(listTools).toHaveBeenCalledTimes(1);
    expect(toolsFromDefinitions).toHaveBeenCalledTimes(1);
    expect(nativeExecute).toHaveBeenCalledTimes(1);
    expect(output).toEqual({
      content: [{ type: "text", text: "found" }],
    });
    expect(lookup.toModelOutput).toBe(nativeToModelOutput);
    expect(
      await lookup.toModelOutput?.({
        toolCallId: "call-1",
        input: { query: "crux" },
        output,
      }),
    ).toEqual({ type: "json", value: output });
    expect(nativeToModelOutput).toHaveBeenCalledTimes(1);
    expect(runtimeUpdates).toEqual([
      expect.objectContaining({
        operation: "replace",
        owner: { definitionId: "mcp.server:catalog", kind: "mcp.server" },
        ownerFacts: {
          kind: "mcp.discovery",
          implementation: "ai-sdk-native",
          server: {
            untrusted: true,
            name: "native server",
            version: "2.0.0",
          },
        },
        definitions: [expect.objectContaining({ id: "tool:lookup" })],
      }),
    ]);

    await session.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reuses credential-safe redirect handling when follow is explicit", async () => {
    createClientMock.mockResolvedValue({
      listTools: async () => ({ tools: [] }),
      toolsFromDefinitions: () => ({}),
      close: async () => {},
    } as never);

    const session = await materializeAiSdkMcpToolSource(
      mcp({
        id: "redirects",
        transport: streamableHttp({
          url: "https://mcp.example.test",
          headers: { Authorization: "Bearer secret" },
          redirect: "follow",
        }),
      }),
      { runtimeContext: undefined },
    );

    expect(createClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: expect.objectContaining({
          type: "http",
          redirect: "follow",
          fetch: expect.any(Function),
        }),
      }),
    );
    await session.close();
  });
});
