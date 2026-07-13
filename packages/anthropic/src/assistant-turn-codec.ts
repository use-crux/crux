import type Anthropic from "@anthropic-ai/sdk";
import type {
  AssistantContentPart,
  MessageContent,
} from "@use-crux/core";
import { createUnsupportedCapabilityError } from "@use-crux/core";
import type {
  NativeAssistantTurn,
  ProviderToolCall,
} from "@use-crux/core/adapter";
import {
  anthropicDocumentBlockToPart,
  anthropicImageBlockToPart,
} from "./content-block-decode";
import { anthropicContentBlocks } from "./tool-result-content";

/** Canonical assistant turn data read from Anthropic content blocks. */
export type AnthropicAssistantTurn = NativeAssistantTurn;

/** Encode a canonical assistant turn, including signed thinking replay. */
export function encodeAnthropicAssistant(
  content: MessageContent | readonly AssistantContentPart[],
  toolCalls: readonly ProviderToolCall[],
): Anthropic.MessageParam {
  if (toolCalls.length === 0) {
    return {
      role: "assistant",
      content:
        typeof content === "string"
          ? content
          : anthropicAssistantBlocks(content),
    };
  }

  const blocks: Anthropic.ContentBlockParam[] = [];
  const contentBlocks =
    typeof content === "string"
      ? content
        ? ([
            { type: "text", text: content },
          ] satisfies Anthropic.TextBlockParam[])
        : []
      : anthropicAssistantBlocks(content);
  blocks.push(...contentBlocks);
  for (const toolCall of toolCalls) {
    blocks.push({
      type: "tool_use",
      id: toolCall.id,
      name: toolCall.name,
      input: toolInput(toolCall.args),
    });
  }
  return { role: "assistant", content: blocks };
}

/** Decode Anthropic response blocks for continuation and tool loops. */
export function readAnthropicAssistantTurn(
  message: Pick<Anthropic.Message, "content">,
): AnthropicAssistantTurn {
  const content = (message as { readonly content?: unknown }).content;
  if (typeof content === "string")
    return { text: content, toolCalls: undefined };
  if (!Array.isArray(content)) return { text: "", toolCalls: undefined };

  const contentParts: AssistantContentPart[] = [];
  const toolCalls: ProviderToolCall[] = [];

  for (const block of content) {
    if (isRedactedThinkingBlock(block)) {
      contentParts.push(redactedThinkingPart(block.data));
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      contentParts.push({
        type: "reasoning",
        text: block.thinking,
        ...(typeof block.signature === "string"
          ? {
              providerOptions: {
                anthropic: { signature: block.signature },
              },
            }
          : {}),
      });
    } else if (block.type === "text") {
      contentParts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      const part = anthropicImageBlockToPart(block.source);
      if (part) contentParts.push(part);
    } else if (block.type === "document") {
      const part = anthropicDocumentBlockToPart(block);
      if (part) contentParts.push(part);
    } else if (block.type === "tool_use") {
      const call = { id: block.id, name: block.name, args: block.input };
      toolCalls.push(call);
      contentParts.push({
        type: "tool-call",
        toolCallId: call.id,
        toolName: call.name,
        input: call.args,
      });
    }
  }

  return {
    text: contentParts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join(""),
    content: contentParts,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function anthropicAssistantBlocks(
  content: readonly AssistantContentPart[],
): Anthropic.ContentBlockParam[] {
  return content.flatMap((part): Anthropic.ContentBlockParam[] => {
    // Canonical transcript extraction supplies tool calls separately.
    if (part.type === "tool-call") return [];
    if (part.type !== "reasoning") return anthropicContentBlocks([part]);

    const continuation = part.providerOptions?.anthropic?.continuation;
    if (isRedactedThinkingBlock(continuation)) {
      return [
        {
          type: "redacted_thinking",
          data: continuation.data,
        } as Anthropic.ContentBlockParam,
      ];
    }

    const signature = part.providerOptions?.anthropic?.signature;
    if (typeof signature !== "string" || signature === "") {
      throw createUnsupportedCapabilityError({
        adapter: "anthropic",
        model: "<custom>",
        issues: [
          {
            capability: "input.reasoning.signature",
            remediation:
              "Replay Anthropic reasoning only from canonical output that preserves its native signature.",
          },
        ],
      });
    }
    return [
      {
        type: "thinking",
        thinking: part.text,
        signature,
      } as Anthropic.ContentBlockParam,
    ];
  });
}

function redactedThinkingPart(data: string): AssistantContentPart {
  return {
    type: "reasoning",
    text: "",
    providerOptions: {
      anthropic: {
        continuation: { type: "redacted_thinking", data },
      },
    },
  };
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

function toolInput(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
