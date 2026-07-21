/** Scripted Core provider fixture for post-skill model-ingress tests. */

import type { AdapterSpec } from "../../src/adapter/spec";
import type {
  AdapterResponse,
  CallArgs,
  ToolResultEntry,
} from "../../src/adapter/types";
import type { Message } from "../../src/generation/messages";

export interface SkillScriptStep {
  readonly text: string;
  readonly toolCalls?: AdapterResponse["toolCalls"];
}

/** Capture each provider call while replaying deterministic tool-loop steps. */
export function scriptedSkillAdapter(
  script: readonly SkillScriptStep[],
  calls: CallArgs[],
): AdapterSpec<object, { readonly ok: true }, never> {
  const remaining = [...script];
  return {
    providerId: "retrieval-skill-amendment",
    async call(_client, args) {
      calls.push(args);
      const step = remaining.shift() ?? { text: "done" };
      return {
        raw: { ok: true },
        extracted: response(step),
      };
    },
    async stream() {
      throw new Error("stream is not used by the skill-amendment fixture");
    },
    appendToolRound(messages, assistant, results) {
      return appendToolRound(messages, assistant, results);
    },
    mapSettings(settings) {
      return { ...settings };
    },
  };
}

function appendToolRound(
  messages: Message[],
  assistant: AdapterResponse,
  results: ToolResultEntry[],
): Message[] {
  return [
    ...messages,
    {
      role: "assistant",
      content: assistant.text,
      metadata: { toolCalls: assistant.toolCalls },
    },
    ...results.map(
      (result): Message => ({
        role: "tool",
        content: result.content,
        metadata: {
          toolCallId: result.toolCallId,
          toolName: result.toolName,
        },
      }),
    ),
  ];
}

function response(step: SkillScriptStep): AdapterResponse {
  return {
    text: step.text,
    toolCalls: step.toolCalls,
    usage: undefined,
    finishReason: step.toolCalls?.length ? "tool-calls" : "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}
