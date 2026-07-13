/**
 * Local behavioral harness for the Anthropic adapter's normalized-outcome suite.
 *
 * Drives the real `createAnthropic(...)` generate/stream surface with small
 * scripted Anthropic clients and projects each run into the provider-neutral
 * snapshot shape from `@use-crux/core/adapter/testing`. Anthropic has a distinct
 * `refusal` stop reason but no distinct content-filter stop reason, so the
 * harness supplies `refusal` and omits `contentFilter`.
 *
 * @module
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import { prompt as makePrompt } from "@use-crux/core";
import { isCruxAdapterError } from "@use-crux/core/adapter";
import type { CruxFinishReason } from "@use-crux/core/adapter";
import type {
  NormalizedErrorSnapshot,
  NormalizedOutcomeBehavioralHarness,
  NormalizedResultSnapshot,
  NormalizedStreamErrorSnapshot,
} from "@use-crux/core/adapter/testing";
import { createAnthropic } from "../src";

const textPrompt = makePrompt({ id: "anthropic-behavior", prompt: "Hi" });

/** Anthropic `messages.create` signature the adapter actually calls. */
type CreateFn = (
  req?: unknown,
  options?: { signal?: AbortSignal },
) => unknown;

/** Build a client from a `messages.create` and/or `messages.stream` pair. */
function client(members: {
  create?: CreateFn;
  stream?: () => MessageStream;
}): Anthropic {
  return { messages: members } as unknown as Anthropic;
}

/** A non-streaming assistant message with the given stop reason. */
function message(stopReason: string): unknown {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-actual",
    content: [{ type: "text", text: "hello" }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 5, output_tokens: 2 },
  };
}

/** A stream that emits text deltas and finalizes with a completed tool call. */
function toolCallStream(): MessageStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of ["Look", "ing"]) {
        yield { type: "content_block_delta", delta: { type: "text_delta", text } };
      }
    },
    finalMessage: async () => ({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-actual",
      content: [
        { type: "text", text: "Looking" },
        { type: "tool_use", id: "call_1", name: "lookup", input: { q: "x" } },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 1 },
    }),
  } as unknown as MessageStream;
}

/** A stream that yields one delta then fails on both iteration and finalization. */
function erroringStream(): MessageStream {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "partial" },
      };
      throw new Error("connection reset");
    },
    finalMessage: async () => {
      throw new Error("connection reset");
    },
  } as unknown as MessageStream;
}

/** Await a rejecting promise and project its normalized provider error. */
async function errorSnapshot(
  promise: Promise<unknown>,
): Promise<NormalizedErrorSnapshot> {
  try {
    await promise;
    throw new Error("expected the call to reject");
  } catch (error) {
    if (!isCruxAdapterError(error)) throw error;
    return {
      kind: error.providerError.kind,
      retryable: error.providerError.retryable,
    };
  }
}

/** The Anthropic behavioral harness bound to the shared conformance contract. */
export function anthropicBehavioralHarness(): NormalizedOutcomeBehavioralHarness {
  const resultOf = async (stopReason: string): Promise<NormalizedResultSnapshot> => {
    const result = await createAnthropic(
      client({ create: async () => message(stopReason) }),
    ).generate(textPrompt, { model: "claude" });
    return { finishReason: result.finalStep.finishReason as CruxFinishReason };
  };

  return {
    generateSuccess: () => resultOf("end_turn"),
    streamCompletedToolCall: async (): Promise<NormalizedResultSnapshot> => {
      const handle = await createAnthropic(
        client({ stream: () => toolCallStream() }),
      ).stream(textPrompt, { model: "claude" });
      for await (const _ of handle.textStream) void _;
      const completed = await handle.completion;
      return {
        finishReason: completed.finalStep.finishReason as CruxFinishReason,
        toolCalls: completed.finalStep.toolCalls,
      };
    },
    refusal: () => resultOf("refusal"),
    timeout: () =>
      errorSnapshot(
        createAnthropic(
          client({ create: () => new Promise<never>(() => {}) }),
        ).generate(textPrompt, { model: "claude", timeout: { stepMs: 20 } }),
      ),
    userAbort: () => {
      const controller = new AbortController();
      controller.abort();
      const create: CreateFn = async (_req, options) => {
        if (options?.signal?.aborted) {
          const err = new Error("Request was aborted.");
          err.name = "AbortError";
          throw err;
        }
        return message("end_turn");
      };
      return errorSnapshot(
        createAnthropic(client({ create })).generate(textPrompt, {
          model: "claude",
          signal: controller.signal,
        }),
      );
    },
    erroringStream: async (): Promise<NormalizedStreamErrorSnapshot> => {
      const handle = await createAnthropic(
        client({ stream: () => erroringStream() }),
      ).stream(textPrompt, { model: "claude" });
      const iteration = await errorSnapshot(
        (async () => {
          for await (const _ of handle.textStream) void _;
        })(),
      );
      const completion = await errorSnapshot(handle.completion);
      return { iteration, completion };
    },
  };
}
