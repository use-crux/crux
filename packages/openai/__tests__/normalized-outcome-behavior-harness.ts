/**
 * Local behavioral harness for the OpenAI adapter's normalized-outcome suite.
 *
 * Drives the real `createOpenAI(...)` generate/stream surface with small
 * scripted OpenAI clients and projects each run into the provider-neutral
 * snapshot shape from `@use-crux/core/adapter/testing`. Kept in a sibling file
 * so the test module stays focused and under the size split threshold.
 *
 * @module
 */

import type OpenAI from "openai";
import { prompt as makePrompt } from "@use-crux/core";
import { isCruxAdapterError } from "@use-crux/core/adapter";
import type { CruxFinishReason } from "@use-crux/core/adapter";
import type {
  NormalizedErrorSnapshot,
  NormalizedOutcomeBehavioralHarness,
  NormalizedResultSnapshot,
  NormalizedStreamErrorSnapshot,
} from "@use-crux/core/adapter/testing";
import { createOpenAI } from "../src";

const textPrompt = makePrompt({ id: "openai-behavior", prompt: "Hi" });

/** OpenAI chat-completions `create` signature the adapter actually calls. */
type CreateFn = (
  req?: unknown,
  options?: { signal?: AbortSignal },
) => unknown;

/** Build a minimal OpenAI-shaped client from a single `create` implementation. */
function client(create: CreateFn): OpenAI {
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

/** A non-streaming chat completion, optionally carrying a model-side refusal. */
function completion(finishReason: string, refusal?: string): unknown {
  return {
    id: "chatcmpl_1",
    model: "gpt-actual",
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: {
          role: "assistant",
          content: "hello",
          ...(refusal ? { refusal } : {}),
        },
      },
    ],
    usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
  };
}

/** A stream that assembles one completed tool call and finishes on `tool_calls`. */
async function* toolCallStream(): AsyncIterable<unknown> {
  yield {
    model: "gpt-actual",
    choices: [{ index: 0, delta: { content: "Look" }, finish_reason: null }],
  };
  yield {
    model: "gpt-actual",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: '{"q":"x"}' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  };
  yield {
    model: "gpt-actual",
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
  };
}

/** A stream that yields one delta and then fails mid-flight. */
async function* erroringStream(): AsyncIterable<unknown> {
  yield {
    choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }],
  };
  throw new Error("connection reset");
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

/** The OpenAI behavioral harness bound to the shared conformance contract. */
export function openaiBehavioralHarness(): NormalizedOutcomeBehavioralHarness {
  const resultOf = async (create: CreateFn): Promise<NormalizedResultSnapshot> => {
    const result = await createOpenAI(client(create)).generate(textPrompt, {
      model: "gpt",
    });
    return { finishReason: result.finalStep.finishReason as CruxFinishReason };
  };

  return {
    generateSuccess: () => resultOf(async () => completion("stop")),
    streamCompletedToolCall: async (): Promise<NormalizedResultSnapshot> => {
      const handle = await createOpenAI(client(async () => toolCallStream())).stream(
        textPrompt,
        { model: "gpt" },
      );
      for await (const _ of handle.textStream) void _;
      const completed = await handle.completion;
      return {
        finishReason: completed.finalStep.finishReason as CruxFinishReason,
        toolCalls: completed.finalStep.toolCalls,
      };
    },
    contentFilter: () => resultOf(async () => completion("content_filter")),
    refusal: () =>
      resultOf(async () => completion("stop", "I can't help with that.")),
    timeout: () =>
      errorSnapshot(
        createOpenAI(client(() => new Promise<never>(() => {}))).generate(
          textPrompt,
          { model: "gpt", timeout: { stepMs: 20 } },
        ),
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
        return completion("stop");
      };
      return errorSnapshot(
        createOpenAI(client(create)).generate(textPrompt, {
          model: "gpt",
          signal: controller.signal,
        }),
      );
    },
    erroringStream: async (): Promise<NormalizedStreamErrorSnapshot> => {
      const handle = await createOpenAI(client(async () => erroringStream())).stream(
        textPrompt,
        { model: "gpt" },
      );
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
