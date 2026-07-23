/**
 * Scripted provider-runtime fixtures for public boundary tests.
 */

import { z } from "zod";
import {
  defineProviderRuntime,
  type NativeAssistantTurn,
  type NativeResponseMetadata,
} from "../../src/adapter";
import type { Message } from "../../src/generation/messages";
import { permissiveCapabilities } from "./structured-output/capability-fixtures";
import type { GenerationSettings, TokenUsage, TraceMeta } from "../../src/generation/types";

const RUNTIME_USAGE = {
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  inputTokenDetails: {},
  outputTokenDetails: {},
} as const;

export interface RuntimeToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

export interface RuntimeProviderMessage {
  readonly role: Message["role"];
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
}

export interface RuntimeRequest {
  readonly model: string;
  readonly mode: "text" | "structured";
  readonly system: string | undefined;
  readonly messages: readonly RuntimeProviderMessage[];
  readonly settings: Record<string, unknown>;
  readonly outputSchema: Record<string, unknown> | undefined;
  readonly tools: readonly string[] | undefined;
  readonly stream?: true;
}

export interface RuntimeRawResponse {
  readonly id: string;
  readonly model: string;
  readonly text: string;
  readonly toolCalls?: readonly RuntimeToolCall[];
  readonly finishReason?: string;
  readonly usage: TokenUsage | undefined;
}

export interface RuntimeStream extends AsyncIterable<{
  readonly text: string;
}> {
  readonly chunks: readonly string[];
}

export interface RuntimeClient {
  readonly calls: RuntimeRequest[];
  readonly streams: RuntimeRequest[];
  readonly responses: RuntimeRawResponse[];
  readonly streamChunks: Array<readonly string[]>;
}

/** Create one raw response consumed by the scripted single-turn runtime. */
export function runtimeResponse(
  text: string,
  overrides: Partial<
    Omit<RuntimeRawResponse, "id" | "model" | "text">
  > = {},
): RuntimeRawResponse {
  return {
    id: `runtime_${Math.random().toString(36).slice(2)}`,
    model: "runtime-actual",
    text,
    usage: RUNTIME_USAGE,
    ...overrides,
  };
}

/** Create a mutable scripted client for the single-turn provider fixture. */
export function createRuntimeClient(
  config: {
    readonly responses?: readonly RuntimeRawResponse[];
    readonly streamChunks?: ReadonlyArray<readonly string[]>;
  } = {},
): RuntimeClient {
  return {
    calls: [],
    streams: [],
    responses: [...(config.responses ?? [])],
    streamChunks: [...(config.streamChunks ?? [])],
  };
}

/** Create the single-turn branch used by provider-runtime parity tests. */
export function createSingleTurnTestRuntime(
  id = "provider-runtime-single-turn",
) {
  return defineProviderRuntime({
    id,
    turn: {
      bind: (client: RuntimeClient) => ({
        async call(request, mode) {
          client.calls.push({ ...request, mode });
          const response = client.responses.shift();
          if (!response)
            throw new Error("single-turn runtime script exhausted");
          return response;
        },
        async stream(request) {
          client.streams.push(request);
          return streamFrom(
            client.streamChunks.shift() ?? ["runtime ", "stream"],
          );
        },
      }),
      request(args, ctx) {
        return {
          model: args.model,
          mode: ctx.mode,
          system: args.system,
          messages: args.providerMessages,
          settings: args.settings,
          outputSchema: ctx.outputSchema,
          tools: args.tools?.map((tool) => tool.name),
        };
      },
      response: {
        meta(raw): NativeResponseMetadata {
          return {
            usage: raw.usage,
            responseId: raw.id,
            actualModelId: raw.model,
            finishReason:
              raw.finishReason ??
              (raw.toolCalls?.length ? "tool_calls" : "stop"),
          };
        },
      },
      stream: {
        request: (request) => ({ ...request, stream: true as const }),
        textDelta: (chunk) =>
          isRuntimeStreamChunk(chunk) ? chunk.text : undefined,
        completion: async (stream): Promise<TraceMeta> => ({
          usage: RUNTIME_USAGE,
          finishReason: "stop",
          responseId: `runtime_stream_${stream.chunks.length}`,
        }),
      },
      settings(settings: GenerationSettings) {
        return {
          ...(settings.temperature !== undefined
            ? { temperature: settings.temperature }
            : {}),
          ...(settings.maxTokens !== undefined
            ? { max_output_tokens: settings.maxTokens }
            : {}),
          ...(settings.toolChoice !== undefined
            ? { tool_choice: settings.toolChoice }
            : {}),
        };
      },
      structuredOutput: { accepts: permissiveCapabilities },
      transcript: {
        fromMessages: (messages) =>
          messages.map((message) => ({
            role: message.role,
            text: message.content,
            ...(message.metadata ? { metadata: message.metadata } : {}),
          })),
        toMessages: (messages) =>
          messages.flatMap((message) =>
            isRuntimeProviderMessage(message)
              ? [
                  {
                    role: message.role,
                    content: message.text,
                    ...(message.metadata ? { metadata: message.metadata } : {}),
                  },
                ]
              : [],
          ),
        readAssistant(raw): NativeAssistantTurn {
          return {
            text: raw.text,
            toolCalls: raw.toolCalls
              ? raw.toolCalls.map((toolCall) => ({ ...toolCall }))
              : undefined,
          };
        },
      },
    },
  });
}

function streamFrom(chunks: readonly string[]): RuntimeStream {
  return {
    chunks,
    async *[Symbol.asyncIterator]() {
      for (const text of chunks) {
        yield { text };
      }
    },
  };
}

function isRuntimeStreamChunk(
  chunk: unknown,
): chunk is { readonly text: string } {
  return (
    typeof chunk === "object" &&
    chunk !== null &&
    typeof (chunk as { readonly text?: unknown }).text === "string"
  );
}

function isRuntimeProviderMessage(
  message: unknown,
): message is RuntimeProviderMessage {
  if (typeof message !== "object" || message === null) return false;
  const record = message as {
    readonly role?: unknown;
    readonly text?: unknown;
  };
  return (
    (record.role === "system" ||
      record.role === "user" ||
      record.role === "assistant" ||
      record.role === "tool") &&
    typeof record.text === "string"
  );
}
