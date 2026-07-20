/**
 * `MockLanguageModelV3` builders with correct V3 result shapes
 * (structured `finishReason: { unified, raw }`, nested usage).
 * Shared by loop-fidelity and conformance tests.
 */

import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModel } from "ai";
import type {
  LanguageModelV3Content,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

export interface MockEmission {
  /** Exact native model parts, for provider-executed tool and media tests. */
  content?: readonly LanguageModelV3Content[];
  text?: string;
  toolCalls?: ReadonlyArray<{ id?: string; name: string; args?: unknown }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } | null;
}

function v3Result(emission: MockEmission, sequence: number) {
  const content: Array<Record<string, unknown>> = emission.content
    ? [...emission.content]
    : [];
  if (!emission.content) {
    if (emission.text) content.push({ type: "text", text: emission.text });
    for (const [index, tc] of (emission.toolCalls ?? []).entries()) {
      content.push({
        type: "tool-call",
        toolCallId: tc.id ?? `tc_${sequence}_${index}`,
        toolName: tc.name,
        input: JSON.stringify(tc.args ?? {}),
      });
    }
  }
  const hasToolCall = content.some((part) => part.type === "tool-call");
  return {
    content,
    finishReason: {
      unified: (hasToolCall ? "tool-calls" : "stop") as "tool-calls" | "stop",
      raw: undefined,
    },
    usage:
      emission.usage === null
        ? {
            inputTokens: {
              total: undefined,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: {
              total: undefined,
              text: undefined,
              reasoning: undefined,
            },
          }
        : emission.usage !== undefined
          ? {
              inputTokens: {
                total: emission.usage.inputTokens,
                noCache: emission.usage.inputTokens,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: {
                total: emission.usage.outputTokens,
                text: emission.usage.outputTokens,
                reasoning: undefined,
              },
            }
          : {
              inputTokens: {
                total: 5,
                noCache: 5,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 7, text: 7, reasoning: undefined },
            },
    warnings: [],
  };
}

/** A V3 mock model that replays the scripted step emissions in order. */
export function emissionModel(
  emissions: readonly MockEmission[],
): LanguageModel {
  const queue = [...emissions];
  let sequence = 0;
  return new MockLanguageModelV3({
    doGenerate: async () =>
      v3Result(queue.shift() ?? { text: "exhausted" }, sequence++) as never,
  }) as unknown as LanguageModel;
}

/**
 * Like {@link emissionModel}, but also records the prompt each step sent to
 * the model — for asserting what the model actually saw mid-loop (e.g.
 * repaired tool-error results).
 */
export function capturingEmissionModel(emissions: readonly MockEmission[]): {
  model: LanguageModel;
  prompts: unknown[][];
} {
  const queue = [...emissions];
  const prompts: unknown[][] = [];
  let sequence = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (options: { prompt: unknown[] }) => {
      prompts.push(options.prompt);
      return v3Result(
        queue.shift() ?? { text: "exhausted" },
        sequence++,
      ) as never;
    },
  }) as unknown as LanguageModel;
  return { model, prompts };
}

/** A V3 mock model that streams the given text deltas as one text block. */
export function streamingModel(deltas: readonly string[]): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          ...deltas.map((delta) => ({
            type: "text-delta" as const,
            id: "t1",
            delta,
          })),
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage: {
              inputTokens: {
                total: 5,
                noCache: 5,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 7, text: 7, reasoning: undefined },
            },
          },
        ] as never[],
      }),
    }),
  }) as unknown as LanguageModel;
}

/** A V3 mock model that streams caller-supplied ordered content parts. */
export function streamingPartsModel(
  parts: readonly LanguageModelV3StreamPart[],
): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          ...parts,
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage: {
              inputTokens: {
                total: 5,
                noCache: 5,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 7, text: 7, reasoning: undefined },
            },
          },
        ] as never[],
      }),
    }),
  }) as unknown as LanguageModel;
}

/** A V3 mock model that replays raw structured-output texts in order. */
export function structuredModel(texts: readonly string[]): LanguageModel {
  const queue = [...texts];
  let sequence = 0;
  return new MockLanguageModelV3({
    doGenerate: async () =>
      v3Result({ text: queue.shift() ?? "{}" }, sequence++) as never,
  }) as unknown as LanguageModel;
}
