/** Shared Core adapter fixture for canonical tool-ingress tests. */

import { z } from "zod";
import type { AdapterSpec } from "../../src/adapter/spec";
import type { AdapterResponse } from "../../src/adapter/types";
import type { Message } from "../../src/generation/messages";
import { prompt } from "../../src/prompt/prompt";
import type { AssistantContentPart } from "../../src/types/content";

export function toolIngressPrompt() {
  return prompt({
    id: "tool-ingress",
    prompt: ({ input }) => input.message,
    input: z.object({ message: z.string() }),
  });
}

export interface ToolIngressStep {
  readonly text: string;
  readonly content?: readonly AssistantContentPart[];
  readonly toolCalls?: AdapterResponse["toolCalls"];
  readonly warnings?: readonly unknown[];
  readonly providerMetadata?: unknown;
}

/** Create deterministic generate and stream provider steps with request capture. */
export function toolIngressScript(steps: readonly ToolIngressStep[]) {
  const queue = [...steps];
  let calls = 0;
  const providerMessages: Array<readonly Message[]> = [];
  const client = { kind: "tool-ingress" as const };
  const spec: AdapterSpec<
    typeof client,
    { readonly call: number },
    AsyncIterable<{ readonly text: string }>
  > = {
    providerId: "tool-ingress",
    async call(_client, args) {
      calls++;
      providerMessages.push(args.messages);
      const next = queue.shift() ?? { text: "exhausted" };
      return {
        raw: { call: calls },
        extracted: response(next),
      };
    },
    async stream(_client, args) {
      calls++;
      providerMessages.push(args.messages);
      const rawStream = (async function* () {
        yield { text: "streamed" };
      })();
      return {
        rawStream,
        extractTextDelta: (chunk) =>
          (chunk as { readonly text?: string }).text,
        completion: async () => ({ text: "streamed", finishReason: "stop" }),
      };
    },
    appendToolRound(messages, assistant, results) {
      return [
        ...messages,
        {
          role: "assistant",
          content: assistant.text,
          metadata: { toolCalls: assistant.toolCalls },
        },
        ...results.map((result) => ({
          role: "tool" as const,
          content: result.content,
          metadata: { toolCallId: result.toolCallId, toolName: result.name },
        })),
      ];
    },
    mapSettings(settings) {
      return { ...settings };
    },
  };
  return {
    spec,
    client,
    get calls() {
      return calls;
    },
    providerMessages,
  };
}

function response(step: ToolIngressStep): AdapterResponse {
  return {
    text: step.text,
    content: step.content,
    toolCalls: step.toolCalls,
    usage: undefined,
    finishReason: step.toolCalls?.length ? "tool_calls" : "stop",
    responseId: undefined,
    actualModelId: undefined,
    warnings: step.warnings,
    providerMetadata: step.providerMetadata,
  };
}
