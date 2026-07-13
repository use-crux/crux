import type { AssistantContentPart } from "../../../types/content";
import type { JsonValue, ProviderOptions } from "../../../types/tool";
import type { ProviderToolCall } from "./units";

/** Lower canonical assistant content to provider-neutral transcript fields. */
export function assistantTranscript(
  content: string | readonly AssistantContentPart[],
  metadataToolCalls: unknown,
  preserveReasoning = false,
): {
  readonly content: string | readonly AssistantContentPart[];
  readonly toolCalls: readonly ProviderToolCall[];
} {
  if (typeof content === "string") {
    return { content, toolCalls: toolCallsFromMetadata(metadataToolCalls) };
  }

  const contentParts: AssistantContentPart[] = [];
  const toolCalls: ProviderToolCall[] = [];
  const seen = new Set<string>();
  for (const part of content) {
    if (part.type === "tool-call") {
      if (!seen.has(part.toolCallId)) {
        seen.add(part.toolCallId);
        toolCalls.push({
          id: part.toolCallId,
          name: part.toolName,
          args: part.input,
          ...(part.providerOptions
            ? { providerOptions: part.providerOptions }
            : {}),
        });
      }
      continue;
    }
    if (part.type !== "reasoning" || preserveReasoning) {
      contentParts.push(part);
    }
  }
  for (const call of toolCallsFromMetadata(metadataToolCalls)) {
    if (seen.has(call.id)) continue;
    seen.add(call.id);
    toolCalls.push(call);
  }
  return { content: contentParts, toolCalls };
}

/** Merge transcript tool calls into canonical assistant content once. */
export function assistantContentWithToolCalls(
  content: string | readonly AssistantContentPart[],
  toolCalls: readonly ProviderToolCall[] | undefined,
): string | readonly AssistantContentPart[] {
  if (!toolCalls || toolCalls.length === 0) return content;
  const parts: AssistantContentPart[] =
    typeof content === "string"
      ? content === ""
        ? []
        : [{ type: "text", text: content }]
      : [...content];
  const seen = new Set(
    parts.flatMap((part) =>
      part.type === "tool-call" ? [part.toolCallId] : [],
    ),
  );
  for (const call of toolCalls) {
    if (seen.has(call.id)) continue;
    seen.add(call.id);
    parts.push({
      type: "tool-call",
      toolCallId: call.id,
      toolName: call.name,
      input: call.args,
      ...(call.providerOptions ? { providerOptions: call.providerOptions } : {}),
    });
  }
  return parts;
}

function toolCallsFromMetadata(value: unknown): ProviderToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ProviderToolCall[] => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string"
    )
      return [];
    return [{
      id: item.id,
      name: item.name,
      args: item.args,
      ...(isProviderOptions(item.providerOptions)
        ? { providerOptions: item.providerOptions }
        : {}),
    }];
  });
}

function isProviderOptions(value: unknown): value is ProviderOptions {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (provider) =>
        isRecord(provider) && Object.values(provider).every(isJsonValue),
    )
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
