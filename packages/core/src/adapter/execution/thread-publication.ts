/** Canonical message selection for one managed Thread publication. */

import type { Message } from "../../generation/messages";
import type { ToolCallPart } from "../../types/content";
import type { ManagedThreadResult } from "./thread-history";

/** Select the complete accepted user, Tool, and assistant turn. @internal */
export function acceptedThreadTurnMessages(
  userMessage: Message | undefined,
  tail: readonly Message[],
  result: ManagedThreadResult,
): Message[] {
  const rounds: Message[] = [];
  let finalAssistant: Message | undefined;
  for (let index = 0; index < tail.length; index += 1) {
    const message = tail[index];
    if (message?.role !== "assistant") continue;
    const calls = assistantToolCalls(message);
    if (calls.length === 0) {
      finalAssistant = message;
      continue;
    }
    const pending = new Set(calls.map((call) => call.toolCallId));
    const results: Message[] = [];
    for (
      let resultIndex = index + 1;
      resultIndex < tail.length;
      resultIndex += 1
    ) {
      const toolResult = tail[resultIndex];
      if (toolResult?.role !== "tool") break;
      const toolCallId = toolResult.metadata?.toolCallId;
      if (typeof toolCallId === "string" && pending.delete(toolCallId)) {
        results.push(toolResult);
      }
      index = resultIndex;
    }
    if (pending.size === 0) {
      rounds.push(canonicalToolCallMessage(message, calls), ...results);
    }
  }
  const assistant =
    finalAssistant ??
    (tail.length === 0 ? acceptedAssistant(result) : undefined);
  return [
    ...(userMessage ? [userMessage] : []),
    ...rounds,
    ...(assistant ? [assistant] : []),
  ];
}

function acceptedAssistant(result: ManagedThreadResult): Message | undefined {
  const content =
    result.content ??
    (result.text === undefined
      ? undefined
      : [{ type: "text" as const, text: result.text }]);
  return content === undefined ? undefined : { role: "assistant", content };
}

function assistantToolCalls(message: Message): readonly ToolCallPart[] {
  if (message.role !== "assistant") return [];
  const contentCalls =
    typeof message.content === "string"
      ? []
      : message.content.filter(
          (part): part is ToolCallPart => part.type === "tool-call",
        );
  if (contentCalls.length > 0) return contentCalls;
  const metadataCalls = message.metadata?.toolCalls;
  if (!Array.isArray(metadataCalls)) return [];
  return metadataCalls.flatMap((call) => {
    if (
      typeof call !== "object" ||
      call === null ||
      !("id" in call) ||
      !("name" in call) ||
      typeof call.id !== "string" ||
      typeof call.name !== "string"
    ) {
      return [];
    }
    return [
      {
        type: "tool-call" as const,
        toolCallId: call.id,
        toolName: call.name,
        input: "args" in call ? call.args : undefined,
      },
    ];
  });
}

function canonicalToolCallMessage(
  message: Extract<Message, { role: "assistant" }>,
  calls: readonly ToolCallPart[],
): Message {
  const content =
    typeof message.content === "string"
      ? [
          ...(message.content
            ? [{ type: "text" as const, text: message.content }]
            : []),
          ...calls,
        ]
      : [
          ...message.content.filter((part) => part.type !== "tool-call"),
          ...calls,
        ];
  return { ...message, content };
}
