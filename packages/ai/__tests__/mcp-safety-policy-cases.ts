import { prompt } from "@use-crux/core";
import {
  boundary,
  constraint,
  guardrail,
  GuardrailBlockedError,
} from "@use-crux/core/safety";
import {
  materializeAiSdkMcpToolSource,
  mcp,
  streamableHttp,
} from "@use-crux/mcp";
import { expect, it, vi } from "vitest";

import { createCruxAi } from "../src";
import type { SdkGateway } from "../src/gateway";
import { scriptedGateway } from "./scripted-gateway";

const materializeMock = vi.mocked(materializeAiSdkMcpToolSource);

/** Registers AI-native MCP guardrail and constraint adapter cases. */
export function registerAiMcpSafetyPolicyCases(): void {
  it("blocks input before AI-native MCP materialization", async () => {
    await expect(
      createCruxAi({ gateway: scriptedGateway().gateway }).generate(
        prompt({
          id: "ai-native-mcp-input-guard",
          use: [mcpSource()],
          prompt: "Unsafe input.",
        }),
        {
          model: "test:model" as never,
          guardrails: [
            guardrail({
              id: "block-input",
              on: boundary.input.text(),
              run: async () => ({
                action: "block",
                reason: "Unsafe input blocked.",
              }),
            }),
          ],
        },
      ),
    ).rejects.toBeInstanceOf(GuardrailBlockedError);

    expect(materializeMock).not.toHaveBeenCalled();
  });

  it("guards and retries output after AI-native MCP execution", async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: "text", text: "source" }],
    }));
    materializeMock.mockResolvedValue({
      tools: {
        lookup: {
          description: "Look up a source.",
          inputSchema: { jsonSchema: { type: "object" } },
          execute,
          toModelOutput: ({ output }: { output: unknown }) => ({
            type: "json" as const,
            value: output,
          }),
        },
      },
      close: vi.fn(async () => {}),
    } as never);
    const scripted = scriptedGateway({
      generateText: [{ text: "private claim" }, { text: "safe claim [1]" }],
    });
    let calls = 0;
    const gateway: SdkGateway = {
      ...scripted.gateway,
      async generateText(args) {
        calls += 1;
        if (calls === 1) {
          const tool = (args.tools as Record<string, unknown>).lookup as {
            execute: (
              input: unknown,
              options: { toolCallId: string },
            ) => Promise<unknown>;
          };
          await tool.execute({}, { toolCallId: "mcp-call-1" });
        }
        return scripted.gateway.generateText(args);
      },
    };
    const result = await createCruxAi({ gateway }).generate(
      prompt({
        id: "ai-native-mcp-output-safety",
        use: [mcpSource()],
        prompt: "Use the tool.",
      }),
      {
        model: "test:model" as never,
        guardrails: [
          guardrail({
            id: "redact-private",
            on: boundary.output.text(),
            run: async (text) => ({
              action: "rewrite",
              value: text.replace("private", "[redacted]"),
              rewrite: { kind: "redact" },
            }),
          }),
        ],
        constraints: [
          constraint({
            id: "require-citation",
            on: boundary.output.text(),
            maxRetries: 1,
            run: async (text) =>
              text.includes("[1]")
                ? { pass: true }
                : { pass: false, feedback: "Add a citation." },
          }),
        ],
      },
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(scripted.calls.generateText).toHaveLength(2);
    expect(result.text).toBe("safe claim [1]");
  });
}

function mcpSource() {
  return mcp({
    id: "ai-native-safety",
    transport: streamableHttp({ url: "https://mcp.example.test" }),
  });
}
