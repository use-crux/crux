import { beforeEach, describe, expect, it, vi } from "vitest";
import { prompt } from "@use-crux/core";
import {
  materializeAiSdkMcpToolSource,
  mcp,
  streamableHttp,
} from "@use-crux/mcp";

import { createCruxAi } from "../src";
import { scriptedGateway } from "./scripted-gateway";

vi.mock("@use-crux/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@use-crux/mcp")>()),
  materializeAiSdkMcpToolSource: vi.fn(),
}));

const materializeMock = vi.mocked(materializeAiSdkMcpToolSource);
const source = mcp({
  id: "conformance",
  transport: streamableHttp({ url: "https://mcp.example.test" }),
});
const assistant = prompt({
  id: "mcp-conformance",
  use: [source],
  prompt: "Run.",
});

describe("AI SDK MCP invocation conformance", () => {
  beforeEach(() => {
    materializeMock.mockReset();
  });

  it("discovers fresh tools and closes every invocation", async () => {
    const firstClose = vi.fn(async () => {});
    const secondClose = vi.fn(async () => {});
    materializeMock
      .mockResolvedValueOnce({
        tools: { first: sdkTool("first") },
        close: firstClose,
      } as never)
      .mockResolvedValueOnce({
        tools: { second: sdkTool("second") },
        close: secondClose,
      } as never);
    const scripted = scriptedGateway({
      generateText: [{ text: "one" }, { text: "two" }],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    await ai.generate(assistant, { model: "test:model" as never });
    await ai.generate(assistant, { model: "test:model" as never });

    const firstTools = Object.keys(
      scripted.calls.generateText[0]!.tools as object,
    );
    const secondTools = Object.keys(
      scripted.calls.generateText[1]!.tools as object,
    );
    expect(firstTools).toContain("first");
    expect(firstTools).not.toContain("second");
    expect(secondTools).toContain("second");
    expect(secondTools).not.toContain("first");
    expect(materializeMock).toHaveBeenCalledTimes(2);
    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it("closes the MCP session when the SDK gateway fails", async () => {
    const close = vi.fn(async () => {});
    materializeMock.mockResolvedValue({
      tools: { lookup: sdkTool("lookup") },
      close,
    } as never);
    const scripted = scriptedGateway({
      generateText: [new Error("provider unavailable")],
    });

    await expect(
      createCruxAi({ gateway: scripted.gateway }).generate(assistant, {
        model: "test:model" as never,
      }),
    ).rejects.toThrow(/provider unavailable/i);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

function sdkTool(name: string) {
  return {
    description: name,
    inputSchema: { jsonSchema: { type: "object" } },
    execute: async () => ({ content: [{ type: "text", text: name }] }),
    toModelOutput: ({ output }: { output: unknown }) => ({
      type: "json" as const,
      value: output,
    }),
  };
}
