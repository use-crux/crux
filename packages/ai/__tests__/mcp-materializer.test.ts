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

const materializeMcpMock = vi.mocked(materializeAiSdkMcpToolSource);

describe("AI SDK-native MCP materialization", () => {
  beforeEach(() => {
    materializeMcpMock.mockReset();
  });

  it("materializes lazily but sends only lifecycle-wrapped tools to the SDK", async () => {
    const nativeExecute = vi.fn(async () => ({
      content: [{ type: "text", text: "native result" }],
    }));
    const nativeToModelOutput = vi.fn(({ output }: { output: unknown }) => ({
      type: "text",
      value: JSON.stringify(output),
    }));
    const close = vi.fn(async () => {});
    const nativeTool = {
      description: "Look up a record",
      inputSchema: { jsonSchema: {} },
      execute: nativeExecute,
      toModelOutput: nativeToModelOutput,
    };
    materializeMcpMock.mockResolvedValue({
      tools: { lookup: nativeTool },
      close,
    } as never);

    const source = mcp({
      id: "catalog",
      transport: streamableHttp({ url: "https://mcp.example.test" }),
    });
    const assistant = prompt({
      id: "native-mcp",
      use: [source],
      prompt: "Find it.",
    });
    const scripted = scriptedGateway({
      generateText: [{ text: "done" }],
    });

    await createCruxAi({ gateway: scripted.gateway }).generate(assistant, {
      model: "openai:gpt-4o" as never,
    });

    expect(materializeMcpMock).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);

    const sdkTools = scripted.calls.generateText[0]?.tools as Record<
      string,
      { execute?: unknown; toModelOutput?: unknown }
    >;
    expect(sdkTools.lookup).toBeDefined();
    expect(sdkTools.lookup).not.toBe(nativeTool);
    expect(sdkTools.lookup?.execute).not.toBe(nativeExecute);
    expect(sdkTools.lookup?.toModelOutput).toBe(nativeToModelOutput);
  });

  it.each(["generate", "stream"] as const)(
    "closes when SDK %s lifecycle preparation rejects toolsContext",
    async (method) => {
      const close = vi.fn(async () => {});
      materializeMcpMock.mockResolvedValue({
        tools: {
          lookup: {
            description: "No context schema.",
            inputSchema: { jsonSchema: {} },
          },
        },
        close,
      } as never);
      const assistant = prompt({
        id: `native-mcp-${method}-setup-failure`,
        use: [
          mcp({
            id: "catalog",
            transport: streamableHttp({ url: "https://mcp.example.test" }),
          }),
        ],
        prompt: "Do not call the provider.",
      });
      const scripted = scriptedGateway();
      const crux = createCruxAi({ gateway: scripted.gateway });

      await expect(
        crux[method](assistant, {
          model: "openai:gpt-4o" as never,
          toolsContext: { lookup: { opaque: true } } as never,
        }),
      ).rejects.toThrow(
        'toolsContext.lookup was provided, but tool "lookup" does not declare contextSchema',
      );
      expect(close).toHaveBeenCalledOnce();
      expect(scripted.calls.generateText).toHaveLength(0);
      expect(scripted.calls.streamText).toHaveLength(0);
    },
  );
});
