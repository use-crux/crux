import { beforeEach, describe, expect, it, vi } from "vitest";
import { prompt } from "@use-crux/core";
import {
  materializeAiSdkMcpToolSource,
  mcp,
  streamableHttp,
} from "@use-crux/mcp";
import { describeMcpAdapterConformance } from "@use-crux/mcp/testing/vitest";

import { createCruxAi } from "../src";
import type { SdkGateway } from "../src/gateway";
import { scriptedGateway } from "./scripted-gateway";

vi.mock("@use-crux/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@use-crux/mcp")>()),
  materializeAiSdkMcpToolSource: vi.fn(),
}));

const materializeMock = vi.mocked(materializeAiSdkMcpToolSource);
const source = mcp({
  id: "ai-sdk-conformance",
  transport: streamableHttp({ url: "https://mcp.example.test" }),
});

beforeEach(() => {
  materializeMock.mockReset();
});

describeMcpAdapterConformance("AI SDK", {
  async invokeMcp() {
    const executions: Array<{
      name: string;
      input: Readonly<Record<string, unknown>>;
    }> = [];
    const close = vi.fn(async () => {});
    materializeMock.mockResolvedValue(
      session(close, async (input) => {
        executions.push({ name: "lookup", input });
        return { content: [{ type: "text", text: "from MCP" }] };
      }),
    );
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    const exposedToolNames: string[] = [];
    const gateway: SdkGateway = {
      ...scripted.gateway,
      async generateText(args) {
        const tools = args.tools as Record<
          string,
          {
            execute?: (
              input: Record<string, unknown>,
              options: { toolCallId: string },
            ) => Promise<unknown>;
          }
        >;
        exposedToolNames.push(...Object.keys(tools));
        await tools.lookup?.execute?.(
          { query: "crux" },
          { toolCallId: "mcp-call-1" },
        );
        return scripted.gateway.generateText(args);
      },
    };
    const result = await createCruxAi({ gateway }).generate(mcpPrompt(), {
      model: "openai:gpt-4o" as never,
    });

    return {
      materializeCount: materializeMock.mock.calls.length,
      exposedToolNames,
      executions,
      closeCount: close.mock.calls.length,
      text: result.text,
    };
  },

  async invokeOrdinary() {
    const scripted = scriptedGateway({ generateText: [{ text: "done" }] });
    await createCruxAi({ gateway: scripted.gateway }).generate(
      prompt({ id: "ai-sdk-ordinary", prompt: "Answer directly." }),
      { model: "openai:gpt-4o" as never },
    );
    return { materializeCount: materializeMock.mock.calls.length };
  },

  async invokeProviderFailure() {
    const close = vi.fn(async () => {});
    materializeMock.mockResolvedValue(
      session(close, async () => ({ content: [] })),
    );
    const scripted = scriptedGateway({
      generateText: [new Error("provider unavailable")],
    });
    let rejected = false;
    try {
      await createCruxAi({ gateway: scripted.gateway }).generate(mcpPrompt(), {
        model: "openai:gpt-4o" as never,
      });
    } catch {
      rejected = true;
    }
    return { rejected, closeCount: close.mock.calls.length };
  },
});

describe("AI SDK MCP invocation freshness", () => {
  it("discovers fresh tools and closes every invocation", async () => {
    const firstClose = vi.fn(async () => {});
    const secondClose = vi.fn(async () => {});
    materializeMock
      .mockResolvedValueOnce(
        session(firstClose, async () => ({ content: [] }), "first"),
      )
      .mockResolvedValueOnce(
        session(secondClose, async () => ({ content: [] }), "second"),
      );
    const scripted = scriptedGateway({
      generateText: [{ text: "one" }, { text: "two" }],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    await ai.generate(mcpPrompt(), { model: "openai:gpt-4o" as never });
    await ai.generate(mcpPrompt(), { model: "openai:gpt-4o" as never });

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
    expect(firstClose).toHaveBeenCalledOnce();
    expect(secondClose).toHaveBeenCalledOnce();
  });
});

function mcpPrompt() {
  return prompt({
    id: "ai-sdk-mcp-conformance",
    use: [source],
    prompt: "Use the lookup tool.",
  });
}

function session(
  close: () => Promise<void>,
  execute: (input: Record<string, unknown>) => Promise<unknown>,
  name = "lookup",
) {
  return {
    tools: {
      [name]: {
        description: "Look up a value",
        inputSchema: { jsonSchema: { type: "object" } },
        execute,
        toModelOutput: ({ output }: { output: unknown }) => ({
          type: "json" as const,
          value: output,
        }),
      },
    },
    close,
  } as never;
}
