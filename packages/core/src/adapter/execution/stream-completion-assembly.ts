/** Provider-neutral message/content assembly for completed streams. @internal */

import type { Message } from "../../generation/messages";
import type { TraceMeta } from "../../generation/types";
import type { AssistantContentPart } from "../../types/content";
import { responseContent } from "../assistant-output";

interface CompletionContentMeta {
  readonly content?: readonly AssistantContentPart[];
  readonly toolCalls?: TraceMeta["toolCalls"];
}

/** Build canonical assistant content from completion metadata and fallback text. */
export function streamCompletionContent(
  meta: CompletionContentMeta | undefined,
  text: string,
): readonly AssistantContentPart[] {
  return responseContent({
    content: meta?.content,
    text,
    toolCalls: meta?.toolCalls?.flatMap((call) =>
      typeof call.id === "string"
        ? [{ id: call.id, name: call.name, args: call.args }]
        : [],
    ),
  });
}

/** Replace the assistant text part with rewritten structured text. */
export function replaceAssistantText(
  content: readonly AssistantContentPart[],
  text: string,
): readonly AssistantContentPart[] {
  let replaced = false;
  const next = content.map((part) => {
    if (part.type !== "text" || replaced) return part;
    replaced = true;
    return part.text === text ? part : { ...part, text };
  });
  return replaced ? next : [...next, { type: "text", text }];
}

/** Replace the final assistant turn or append one when none exists. */
export function replaceFinalAssistant(
  messages: readonly Message[],
  content: readonly AssistantContentPart[],
  toolCalls: TraceMeta["toolCalls"],
): readonly Message[] {
  const result = [...messages];
  for (let index = result.length - 1; index >= 0; index -= 1) {
    const current = result[index];
    if (current?.role !== "assistant") continue;
    const metadata = toolCalls
      ? { ...current.metadata, toolCalls }
      : current.metadata;
    result[index] = {
      ...current,
      content,
      ...(metadata !== undefined ? { metadata } : {}),
    };
    return result;
  }
  result.push(createAssistantMessage(content, toolCalls));
  return result;
}

/** Build one canonical assistant message from completed content. */
export function createAssistantMessage(
  content: readonly AssistantContentPart[],
  toolCalls: TraceMeta["toolCalls"],
): Message {
  return {
    role: "assistant",
    content,
    ...(toolCalls ? { metadata: { toolCalls } } : {}),
  };
}
