/**
 * Canonical result envelope assembly for managed adapter calls.
 *
 * The accumulator is the only place that sums step-level text, usage, and
 * final-step facts. Provider code reports one normalized step at a time; this
 * module decides what the public `GenerateResult`/`StreamCompletion` envelope
 * means across multi-step runs.
 *
 * @module
 */

import type { Message } from "../generation/messages";
import type { TokenUsage, TraceMeta } from "../generation/types";
import type { StreamHandle } from "./types";
import type { ApprovalRequestInfo } from "./tool/approval";

/** Last provider-call step facts exposed next to accumulated result fields. */
export interface FinalStepInfo {
  /** Assistant-visible text produced by the final provider-call step. */
  readonly text: string;
  /**
   * Usage reported by the final provider-call step.
   *
   * Omitted when the provider omitted usage for that step. Crux never
   * fabricates zeros for unmetered provider responses.
   */
  readonly usage?: TokenUsage;
  /** Provider finish reason for the final step, when reported. */
  readonly finishReason: string | undefined;
  /** Provider response id for the final step, when reported. */
  readonly responseId: string | undefined;
  /** Actual provider model id for the final step, when reported. */
  readonly modelId: string | undefined;
}

/** Canonical managed `generate()` result shared by provider adapters. */
export interface GenerateResult<TRaw, TOutput = unknown> {
  /** Assistant-visible text accumulated across provider-call steps. */
  readonly text: string;
  /** Parsed structured output, when the prompt declares an output schema. */
  readonly object?: TOutput;
  /**
   * Usage accumulated across all provider-call steps.
   *
   * Present only when every provider-call step reported usage. If any step is
   * unmetered, the total is unknown and this field is omitted.
   */
  readonly usage?: TokenUsage;
  /** Provider-reported cost shape, promoted from `_meta` for public access. */
  readonly cost?: TraceMeta["cost"];
  /** Number of provider-call steps represented in this envelope. */
  readonly steps: number;
  /** Facts from the final provider-call step. */
  readonly finalStep: FinalStepInfo;
  /** Provider-agnostic Crux message history. */
  readonly messages: Message[];
  /** Approval requests awaiting a decision, present only when execution suspended. */
  readonly pendingApprovals?: readonly ApprovalRequestInfo[];
  /** Raw provider or SDK response object. */
  readonly raw: TRaw;
  /** Trace metadata retained for observability plumbing. */
  readonly _meta: TraceMeta;
}

/** Canonical completion payload resolved by managed `stream()` results. */
export type StreamCompletion<TOutput = unknown> = Omit<
  GenerateResult<never, TOutput>,
  "raw" | "_meta"
>;

/** Canonical managed `stream()` result shared by provider adapters. */
export interface StreamResult<TRawStream, TOutput = unknown> {
  /** Provider-neutral text delta stream. */
  readonly textStream: AsyncIterable<string>;
  /** Raw provider or SDK stream handle. */
  readonly raw: TRawStream;
  /** Resolves to the canonical completion envelope when the stream finishes. */
  readonly completion: Promise<StreamCompletion<TOutput>>;
}

/** One provider-call step that participates in envelope accumulation. */
export interface ResultStepFacts {
  /** Assistant-visible text for this step. */
  readonly text: string;
  /** Usage reported by this step, if any. */
  readonly usage?: TokenUsage;
  /** Provider finish reason, if any. */
  readonly finishReason: string | undefined;
  /** Provider response id, if any. */
  readonly responseId: string | undefined;
  /** Actual provider model id, if any. */
  readonly modelId: string | undefined;
}

/** Fields supplied by the execution runtime when finalizing an envelope. */
export interface ResultEnvelopeBase<TRaw, TOutput = unknown> {
  /** Raw provider/SDK response for the terminal call. */
  readonly raw: TRaw;
  /** Provider-agnostic Crux message history. */
  readonly messages: Message[];
  /** Trace metadata retained for observability plumbing. */
  readonly _meta: TraceMeta;
  /** Parsed structured output, when present. */
  readonly object?: TOutput;
  /** Public cost promoted from `_meta`. */
  readonly cost?: TraceMeta["cost"];
  /** Approval requests when execution suspended. */
  readonly pendingApprovals?: readonly ApprovalRequestInfo[];
}

/** Create a new result accumulator for one managed call. */
export function createResultAccumulator() {
  const steps: ResultStepFacts[] = [];

  return {
    /** Record one provider-call step after Crux policy has finalized its facts. */
    addStep(facts: ResultStepFacts): void {
      steps.push(facts);
    },

    /** Finalize all recorded step facts into the canonical `generate()` envelope. */
    finalize<TRaw, TOutput = unknown>(
      base: ResultEnvelopeBase<TRaw, TOutput>,
    ): GenerateResult<TRaw, TOutput> {
      const usage = sumUsageWhenComplete(steps);
      const finalStep = finalStepInfo(steps.at(-1));
      return {
        text: steps.map((step) => step.text).join(""),
        ...(base.object !== undefined ? { object: base.object } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(base.cost !== undefined ? { cost: base.cost } : {}),
        steps: steps.length,
        finalStep,
        messages: base.messages,
        ...(base.pendingApprovals
          ? { pendingApprovals: base.pendingApprovals }
          : {}),
        raw: base.raw,
        _meta: base._meta,
      };
    },

    /** Finalize all recorded step facts into a canonical stream completion. */
    finalizeCompletion<TOutput = unknown>(
      base: Omit<ResultEnvelopeBase<never, TOutput>, "raw" | "_meta">,
    ): StreamCompletion<TOutput> {
      const usage = sumUsageWhenComplete(steps);
      const finalStep = finalStepInfo(steps.at(-1));
      return {
        text: steps.map((step) => step.text).join(""),
        ...(base.object !== undefined ? { object: base.object } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(base.cost !== undefined ? { cost: base.cost } : {}),
        steps: steps.length,
        finalStep,
        messages: base.messages,
        ...(base.pendingApprovals
          ? { pendingApprovals: base.pendingApprovals }
          : {}),
      };
    },
  };
}

/** Build the public stream envelope from the internal provider stream handle. */
export function createStreamResult<TRawStream, TOutput = unknown>(
  handle: StreamHandle<TRawStream>,
): StreamResult<TRawStream, TOutput> {
  let streamedText = "";
  let resolveStream: (() => void) | undefined;
  let rejectStream: ((error: unknown) => void) | undefined;
  const streamFinished = new Promise<void>((resolve, reject) => {
    resolveStream = resolve;
    rejectStream = reject;
  });

  async function* textStream(): AsyncIterable<string> {
    try {
      for await (const chunk of handle.rawStream as AsyncIterable<unknown>) {
        const delta = handle.extractTextDelta(chunk);
        if (delta === undefined || delta === "") continue;
        streamedText += delta;
        yield delta;
      }
      resolveStream?.();
    } catch (error) {
      rejectStream?.(error);
      throw error;
    }
  }

  const completion = (async (): Promise<StreamCompletion<TOutput>> => {
    await streamFinished;
    const meta = (await handle.completion()) as
      | StreamCompletionMeta<TOutput>
      | undefined;
    const text = typeof meta?.text === "string" ? meta.text : streamedText;
    const accumulator = createResultAccumulator();
    accumulator.addStep({
      text,
      ...(meta?.usage !== undefined ? { usage: meta.usage } : {}),
      finishReason: meta?.finishReason,
      responseId: meta?.responseId,
      modelId: meta?.actualModelId,
    });
    return accumulator.finalizeCompletion({
      messages: meta?.messages ?? [],
      ...(meta?.object !== undefined ? { object: meta.object } : {}),
      ...(meta?.cost !== undefined ? { cost: meta.cost } : {}),
      ...(meta?.pendingApprovals
        ? { pendingApprovals: meta.pendingApprovals }
        : {}),
    });
  })();
  void completion.catch(() => undefined);

  return {
    textStream: textStream(),
    raw: handle.raw ?? handle.rawStream,
    completion,
  };
}

interface StreamCompletionMeta<TOutput> extends TraceMeta {
  readonly text?: string;
  readonly object?: TOutput;
  readonly messages?: Message[];
  readonly pendingApprovals?: readonly ApprovalRequestInfo[];
}

/** Sum usage only when every recorded step is metered. */
export function sumUsageWhenComplete(
  steps: readonly ResultStepFacts[],
): TokenUsage | undefined {
  if (steps.length === 0 || steps.some((step) => step.usage === undefined))
    return undefined;

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let cacheReadTokens: number | undefined;
  let cacheWriteTokens: number | undefined;
  let reasoningTokens: number | undefined;

  for (const step of steps) {
    const usage = step.usage;
    if (!usage) return undefined;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    totalTokens += usage.totalTokens;
    if (usage.inputTokenDetails.cacheReadTokens !== undefined) {
      cacheReadTokens =
        (cacheReadTokens ?? 0) + usage.inputTokenDetails.cacheReadTokens;
    }
    if (usage.inputTokenDetails.cacheWriteTokens !== undefined) {
      cacheWriteTokens =
        (cacheWriteTokens ?? 0) + usage.inputTokenDetails.cacheWriteTokens;
    }
    if (usage.outputTokenDetails.reasoningTokens !== undefined) {
      reasoningTokens =
        (reasoningTokens ?? 0) + usage.outputTokenDetails.reasoningTokens;
    }
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    inputTokenDetails: {
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    },
    outputTokenDetails: {
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    },
  };
}

function finalStepInfo(step: ResultStepFacts | undefined): FinalStepInfo {
  if (!step) {
    return {
      text: "",
      finishReason: undefined,
      responseId: undefined,
      modelId: undefined,
    };
  }

  return {
    text: step.text,
    ...(step.usage !== undefined ? { usage: step.usage } : {}),
    finishReason: step.finishReason,
    responseId: step.responseId,
    modelId: step.modelId,
  };
}
