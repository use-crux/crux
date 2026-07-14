import { vi } from "vitest";

import { adapter } from "../../src/adapter/define-adapter";
import type { AdapterResponse, ToolResultEntry } from "../../src/adapter/types";
import type { Message } from "../../src/generation/messages";

/**
 * Creates a two-step adapter that materializes supplied MCP-shaped tools.
 *
 * The first provider response calls the selected tool and the second completes
 * the turn. Captured results expose the ordinary Core lifecycle boundary to
 * policy conformance tests without depending on a provider-specific codec.
 */
export function createMcpPolicyFixture(options: {
  readonly tools: Readonly<Record<string, unknown>>;
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
}) {
  let providerCalls = 0;
  const close = vi.fn(async () => {});
  const capturedResults: ToolResultEntry[] = [];
  const create = adapter({
    providerId: "mcp-policy-fixture",
    materializeToolSource: async () => ({ tools: options.tools, close }),
    mapSettings: () => ({}),
    async call() {
      providerCalls += 1;
      return providerCalls === 1
        ? {
            raw: { step: 1 },
            extracted: response("", [
              { id: "mcp-call-1", name: options.toolName, args: options.input },
            ]),
          }
        : { raw: { step: 2 }, extracted: response("done") };
    },
    async stream() {
      throw new Error("stream is not used by this fixture");
    },
    appendToolRound(
      messages: Message[],
      assistant: AdapterResponse,
      roundResults: ToolResultEntry[],
    ) {
      capturedResults.push(...roundResults);
      return [
        ...messages,
        {
          role: "assistant" as const,
          content: assistant.text,
          metadata: { toolCalls: assistant.toolCalls },
        },
        ...roundResults.map((result) => ({
          role: "tool" as const,
          content: result.content,
          metadata: { toolCallId: result.toolCallId, toolName: result.name },
        })),
      ];
    },
  });

  return {
    adapter: create({}),
    close,
    results: () => [...capturedResults],
  };
}

function response(
  text: string,
  toolCalls?: AdapterResponse["toolCalls"],
): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      inputTokenDetails: {},
      outputTokenDetails: {},
    },
    finishReason: toolCalls ? "tool_calls" : "stop",
  };
}
