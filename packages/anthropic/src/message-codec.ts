import type Anthropic from "@anthropic-ai/sdk";
import type {
  AssistantContentPart,
  ContentPart,
  Message,
  MessageContent,
} from "@use-crux/core";
import { defineProviderTranscriptCodec } from "@use-crux/core/adapter";
import type {
  ProviderToolCall,
  ProviderToolResult,
  ProviderTranscriptDialect,
  ProviderTranscriptUnit,
  ToolResultEncodingHelpers,
} from "@use-crux/core/adapter";
import {
  encodeAnthropicAssistant,
  readAnthropicAssistantTurn,
} from "./assistant-turn-codec";
export type { AnthropicAssistantTurn } from "./assistant-turn-codec";
import {
  anthropicContentBlocks,
  anthropicToolResultContent,
} from "./tool-result-content";
import {
  anthropicDocumentBlockToPart,
  anthropicImageBlockToPart,
  decodeAnthropicToolResultContent,
  messageContentFromAnthropicParts,
} from "./content-block-decode";

/**
 * Canonical assistant turn data read from Anthropic content blocks.
 *
 * This mirrors the subset of the adapter response that participates in tool
 * loops — assistant text and ordered tool calls. Usage, finish reasons, and
 * model ids stay in the adapter response normalizer.
 */
/**
 * Anthropic wire dialect for the canonical transcript IR.
 *
 * Anthropic's protocol has no `tool` role: assistant tool calls are `tool_use`
 * content blocks, and tool results are user messages carrying `tool_result`
 * blocks. Core supplies neutral transcript units and the tool-result encoding
 * helpers; this dialect only translates them to and from Anthropic blocks.
 */
const anthropicDialect: ProviderTranscriptDialect<
  Anthropic.MessageParam,
  Pick<Anthropic.Message, "content">
> = {
  preserveAssistantReasoning: true,
  encodeContent: ({ role, content }) => encodeContent(role, content),
  encodeAssistant: ({ content, toolCalls }) =>
    encodeAnthropicAssistant(content, toolCalls ?? []),
  encodeToolResults: ({ results }, helpers) =>
    results.map((result) => encodeToolResult(result, helpers)),
  decodeMessage: decodeMessage,
  readAssistant: readAnthropicAssistantTurn,
};

/** Anthropic provider transcript codec used by request builders and response normalization. */
export const anthropicTranscript =
  defineProviderTranscriptCodec(anthropicDialect);

/**
 * Convert canonical Crux messages into Anthropic request messages.
 *
 * Compatibility wrapper around the compiled {@link anthropicTranscript} codec;
 * Anthropic-specific tool-round semantics are owned by the canonical IR in core.
 */
export function fromMessages(
  messages: readonly Message[],
): Anthropic.MessageParam[] {
  return [...anthropicTranscript.fromMessages(messages)];
}

/**
 * Convert Anthropic request messages back into canonical Crux messages.
 *
 * Compatibility wrapper around {@link anthropicTranscript}: `tool_use` blocks
 * become assistant `metadata.toolCalls` and `tool_result` blocks become
 * canonical `tool` messages.
 */
export function toMessages(sdkMessages: readonly unknown[]): Message[] {
  return anthropicTranscript.toMessages(sdkMessages);
}

function encodeContent(
  role: "system" | "user",
  content: MessageContent,
): Anthropic.MessageParam | undefined {
  if (role === "system") {
    return undefined;
  }

  return {
    role,
    content:
      typeof content === "string" ? content : anthropicContentBlocks(content),
  };
}

function encodeToolResult(
  result: ProviderToolResult,
  helpers: ToolResultEncodingHelpers,
): Anthropic.MessageParam {
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: result.toolCallId,
        content: anthropicToolResultContent(
          result.modelOutput,
          helpers.plainText(result),
        ),
        ...(helpers.errorFlag(result) ? { is_error: true } : {}),
      },
    ],
  };
}

function decodeMessage(value: unknown): readonly ProviderTranscriptUnit[] {
  if (!isAnthropicMessageParam(value)) {
    return [{ kind: "content", role: "user", content: String(value ?? "") }];
  }

  if (typeof value.content === "string") {
    return value.role === "assistant"
      ? [{ kind: "assistant", content: value.content }]
      : [{ kind: "content", role: "user", content: value.content }];
  }

  const contentParts: AssistantContentPart[] = [];
  const toolCalls: ProviderToolCall[] = [];
  const toolResults: ProviderToolResult[] = [];

  for (const block of value.content) {
    if (isRedactedThinkingBlock(block)) {
      contentParts.push({
        type: "reasoning",
        text: "",
        providerOptions: {
          anthropic: {
            continuation: {
              type: "redacted_thinking",
              data: block.data,
            },
          },
        },
      });
    } else if (block.type === "text") {
      contentParts.push({ type: "text", text: block.text });
    } else if (block.type === "thinking") {
      contentParts.push({
        type: "reasoning",
        text: block.thinking,
        providerOptions: { anthropic: { signature: block.signature } },
      });
    } else if (block.type === "image") {
      const part = anthropicImageBlockToPart(block.source);
      if (part) contentParts.push(part);
    } else if (block.type === "document") {
      const part = anthropicDocumentBlockToPart(block);
      if (part) contentParts.push(part);
    } else if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, name: block.name, args: block.input });
    } else if (block.type === "tool_result") {
      const decoded = decodeAnthropicToolResultContent(block.content);
      toolResults.push({
        toolCallId: block.tool_use_id,
        text: decoded.text,
        ...(decoded.modelOutput ? { modelOutput: decoded.modelOutput } : {}),
        ...(block.is_error ? { isError: true } : {}),
      });
    }
  }

  if (value.role === "assistant") {
    return [
      {
        kind: "assistant",
        content: mergeAdjacentText(contentParts),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
    ];
  }

  const units: ProviderTranscriptUnit[] = [];
  const content = messageContentFromAnthropicParts(
    contentParts.filter((part): part is ContentPart =>
      part.type !== "reasoning" && part.type !== "tool-call",
    ),
  );
  if (contentParts.length > 0)
    units.push({ kind: "content", role: "user", content });
  if (toolResults.length > 0)
    units.push({ kind: "tool-results", results: toolResults });
  return units.length > 0
    ? units
    : [{ kind: "content", role: "user", content: "" }];
}

function mergeAdjacentText(
  parts: readonly AssistantContentPart[],
): readonly AssistantContentPart[] {
  const merged: AssistantContentPart[] = [];
  for (const part of parts) {
    const previous = merged.at(-1);
    if (part.type === "text" && previous?.type === "text") {
      merged[merged.length - 1] = {
        ...previous,
        text: previous.text + part.text,
      };
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRedactedThinkingBlock(
  value: unknown,
): value is { readonly type: "redacted_thinking"; readonly data: string } {
  return (
    isRecord(value) &&
    value.type === "redacted_thinking" &&
    typeof value.data === "string"
  );
}

function isAnthropicMessageParam(
  value: unknown,
): value is Anthropic.MessageParam {
  return (
    isRecord(value) &&
    (value.role === "user" || value.role === "assistant") &&
    "content" in value
  );
}
