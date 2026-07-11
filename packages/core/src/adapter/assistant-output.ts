/**
 * Canonical assistant-output projections shared by generation boundaries.
 *
 * @internal
 * @module
 */

import type { AssistantContentPart } from "../types/content";
import type { AdapterResponse } from "./types";

/** Return the exact ordered output reported by an adapter response. */
export function responseContent(
  response: Pick<AdapterResponse, "content" | "text" | "toolCalls">,
): readonly AssistantContentPart[] {
  const content = response.content ??
    (response.text === ""
      ? []
      : ([{ type: "text", text: response.text }] as const));
  const presentToolCalls = new Set(
    content
      .filter(
        (part): part is Extract<AssistantContentPart, { type: "tool-call" }> =>
          part.type === "tool-call",
      )
      .map((part) => part.toolCallId),
  );

  return [
    ...content,
    ...(response.toolCalls?.filter((call) => !presentToolCalls.has(call.id)).map(
      (call): AssistantContentPart => ({
        type: "tool-call",
        toolCallId: call.id,
        toolName: call.name,
        input: call.args,
      }),
    ) ?? []),
  ];
}

/** Project only assistant text parts without describing lifecycle or media. */
export function textFromAssistantContent(
  content: readonly AssistantContentPart[],
): string {
  return content
    .filter(
      (part): part is Extract<AssistantContentPart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}
