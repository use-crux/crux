import type OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { AssistantContentPart, Message } from "@use-crux/core";
import { defineProviderTranscriptCodec } from "@use-crux/core/adapter";
import type {
  NativeAssistantTurn,
  NativeAssistantReadContext,
  ProviderToolCall,
  ProviderToolResult,
  ProviderTranscriptDialect,
  ProviderTranscriptUnit,
  ToolResultEncodingHelpers,
} from "@use-crux/core/adapter";
import {
  messageContentFromOpenAIContent,
  openAIContentText,
  openAIMessageContent,
} from "./content-parts";
import { encodeOpenAIAssistant } from "./assistant-message";
import { generatedOpenAIAudioPart } from "./generated-audio";

/** OpenAI assistant turn data read from a chat-completion response. */
export type OpenAIAssistantTurn = NativeAssistantTurn;

/**
 * OpenAI wire dialect for the canonical transcript IR.
 *
 * OpenAI keeps system and user turns as plain role messages, encodes assistant
 * tool calls as a `tool_calls` array, and represents tool results as dedicated
 * `tool` role messages keyed by `tool_call_id`. Core extracts the neutral units
 * and tool-result helpers; this dialect only handles the chat-completion wire
 * format, including JSON argument and rich-content rendering.
 */
const openAIDialect: ProviderTranscriptDialect<
  OpenAI.ChatCompletionMessageParam,
  ChatCompletion
> = {
  encodeContent: ({ role, content }, options) =>
    role === "system"
      ? { role, content: openAIMessageContent(role, content) }
      : { role, content: openAIMessageContent(role, content) },
  encodeAssistant: ({ content, toolCalls }) =>
    encodeOpenAIAssistant(content, toolCalls ?? []),
  encodeToolResults: ({ results }, helpers, options) =>
    results.flatMap((result) => encodeToolResult(result, helpers, options)),
  decodeMessage: decodeMessage,
  readAssistant: readOpenAIAssistant,
};

/** OpenAI provider transcript codec used by request builders and response normalization. */
export const openAITranscript = defineProviderTranscriptCodec(openAIDialect);

/**
 * Convert canonical Crux messages into OpenAI chat-completion messages.
 *
 * Uses the compiled {@link openAITranscript} codec shared by runtime calls.
 */
export function fromMessages(
  messages: readonly Message[],
): OpenAI.ChatCompletionMessageParam[] {
  return [...openAITranscript.fromMessages(messages)];
}

/**
 * Convert OpenAI chat messages back into canonical Crux messages.
 *
 * Uses the same {@link openAITranscript} decoder as runtime responses.
 */
export function toMessages(sdkMessages: readonly unknown[]): Message[] {
  return openAITranscript.toMessages(sdkMessages);
}

/** Read assistant transcript text and tool-call intent from an OpenAI response. */
export function readOpenAIAssistant(
  result: ChatCompletion,
  context?: NativeAssistantReadContext,
): OpenAIAssistantTurn {
  const choiceMessage = result.choices?.[0]?.message as
    | OpenAI.ChatCompletionMessage
    | undefined;
  const toolCalls = toolCallsFromProvider(choiceMessage?.tool_calls);
  const content = assistantContent(choiceMessage, toolCalls, context);
  return {
    text: openAIContentText(choiceMessage?.content),
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function assistantContent(
  message: OpenAI.ChatCompletionMessage | undefined,
  toolCalls: readonly ProviderToolCall[],
  context: NativeAssistantReadContext | undefined,
): readonly AssistantContentPart[] {
  const decoded = messageContentFromOpenAIContent(message?.content);
  const parts: AssistantContentPart[] =
    typeof decoded === "string"
      ? decoded === ""
        ? []
        : [{ type: "text", text: decoded }]
      : [...decoded];
  const audio = generatedOpenAIAudioPart(message, context);
  if (audio) parts.push(audio);
  parts.push(
    ...toolCalls.map(
      (call): AssistantContentPart => ({
        type: "tool-call",
        toolCallId: call.id,
        toolName: call.name,
        input: call.args,
      }),
    ),
  );
  return parts;
}

function encodeToolResult(
  result: ProviderToolResult,
  helpers: ToolResultEncodingHelpers,
  _options: Readonly<Record<never, never>>,
): OpenAI.ChatCompletionMessageParam[] {
  const parts = helpers.contentParts(result);
  const toolMessage: OpenAI.ChatCompletionToolMessageParam = {
    role: "tool",
    content: helpers.plainText(result),
    tool_call_id: result.toolCallId,
  };
  const media = parts?.filter((part) => part.type !== "text") ?? [];
  if (media.length === 0) return [toolMessage];
  return [
    toolMessage,
    {
      role: "user",
      content: openAIMessageContent("user", media),
    },
  ];
}

interface OpenAIMessageLike {
  readonly role: string;
  readonly content: unknown;
  readonly tool_call_id?: unknown;
  readonly name?: unknown;
  readonly tool_calls?: unknown;
  readonly [key: string]: unknown;
}

function decodeMessage(value: unknown): ProviderTranscriptUnit {
  const message = isOpenAIMessageLike(value)
    ? value
    : { role: "user", content: value };
  const role = normalizeRole(message.role);
  const content = messageContentFromOpenAIContent(message.content);
  const text = openAIContentText(message.content);

  if (role === "tool") {
    return {
      kind: "tool-results",
      results: [
        {
          toolCallId:
            typeof message.tool_call_id === "string"
              ? message.tool_call_id
              : "",
          ...(typeof message.name === "string"
            ? { toolName: message.name }
            : {}),
          text,
        },
      ],
    };
  }

  if (role === "assistant") {
    const toolCalls = toolCallsFromProvider(message.tool_calls);
    return {
      kind: "assistant",
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  return { kind: "content", role, content };
}

function toolCallsFromProvider(value: unknown): ProviderToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ProviderToolCall[] => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    if (item.type !== "function" || !isRecord(item.function)) return [];
    if (typeof item.function.name !== "string") return [];
    return [
      {
        id: item.id,
        name: item.function.name,
        args:
          typeof item.function.arguments === "string"
            ? safeParseJson(item.function.arguments)
            : undefined,
      },
    ];
  });
}

function encodeArguments(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? {});
}

function normalizeRole(role: string): "system" | "user" | "assistant" | "tool" {
  if (
    role === "system" ||
    role === "user" ||
    role === "assistant" ||
    role === "tool"
  )
    return role;
  return "user";
}

/**
 * Parse an OpenAI tool-call `arguments` string into args, tolerating provider
 * quirks. Falls back to the raw string when it is empty or malformed JSON, so
 * generate and stream tool-call parsing produce identical args for the same
 * wire input.
 */
export function safeParseJson(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpenAIMessageLike(value: unknown): value is OpenAIMessageLike {
  return (
    isRecord(value) && typeof value.role === "string" && "content" in value
  );
}
