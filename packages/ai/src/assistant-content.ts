/** Exact AI SDK assistant-output decoding. @internal */

import type { AssistantContentPart, ProviderOptions } from "@use-crux/core";
import { decodeContentFromAiSdkParts } from "./content-parts";
import { isRecord, readString } from "./object-utils";

/** Decode ordered text, media, reasoning, and tool-call output. */
export function decodeAssistantContentFromAiSdkParts(
  parts: readonly Record<string, unknown>[],
): readonly AssistantContentPart[] {
  return projectAssistantContentFromAiSdkParts(parts).content;
}

/** Reversible canonical projection with one native index per retained part. */
export function projectAssistantContentFromAiSdkParts(
  parts: readonly Record<string, unknown>[],
): {
  readonly content: readonly AssistantContentPart[];
  readonly nativeIndexes: readonly number[];
} {
  const content: AssistantContentPart[] = [];
  const nativeIndexes: number[] = [];
  for (const [nativeIndex, part] of parts.entries()) {
    for (const canonical of decodeAssistantPart(part)) {
      content.push(canonical);
      nativeIndexes.push(nativeIndex);
    }
  }
  return { content, nativeIndexes };
}

function decodeAssistantPart(
  part: Record<string, unknown>,
): readonly AssistantContentPart[] {
  const type = readString(part, "type");
  if (type === "tool-call") {
    const nested = isRecord(part.toolCall) ? part.toolCall : undefined;
    return [
      {
        type,
        toolCallId:
          readString(part, "toolCallId") ??
          readString(nested, "toolCallId") ??
          "",
        toolName:
          readString(part, "toolName") ?? readString(nested, "toolName") ?? "",
        input: part.input ?? nested?.input,
        ...providerOptionsFrom(part),
      },
    ];
  }
  if (type === "reasoning") {
    return [
      {
        type,
        text: readString(part, "text") ?? "",
        ...providerOptionsFrom(part),
      },
    ];
  }
  if (
    type === "tool-approval-request" ||
    type === "tool-approval-response" ||
    type === "tool-result" ||
    type === "source"
  )
    return [];

  const decoded = decodeContentFromAiSdkParts([part]);
  return typeof decoded === "string"
    ? decoded === ""
      ? []
      : [{ type: "text", text: decoded }]
    : decoded;
}

function providerOptionsFrom(part: Record<string, unknown>) {
  return isRecord(part.providerOptions)
    ? { providerOptions: part.providerOptions as ProviderOptions }
    : {};
}
