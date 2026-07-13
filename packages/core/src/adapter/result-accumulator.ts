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
import type { AssistantContentPart } from "../types/content";
import { textFromAssistantContent } from "./assistant-output";
import type { ApprovalRequestInfo } from "./tool/approval";
import type { RoutingReceipt } from "../routing/receipt";
import { sumUsageWhenComplete } from "./result-usage";

export { createStreamResult } from "./result-stream";
export { sumUsageWhenComplete } from "./result-usage";

/** Last provider-call step facts exposed next to accumulated result fields. */
export interface FinalStepInfo {
  /** Exact ordered assistant output produced by this provider-call step. */
  readonly content: readonly AssistantContentPart[];
  /** Text-only projection of {@link content}. */
  readonly text: string;
  /**
   * Usage reported by the final provider-call step.
   *
   * Omitted when the provider omitted usage for that step. Crux never
   * fabricates zeros for unmetered provider responses.
   */
  readonly usage?: TokenUsage;
  /** Fully assembled tool calls reported by the final provider step. */
  readonly toolCalls?: TraceMeta["toolCalls"];
  /** Provider finish reason for the final step, when reported. */
  readonly finishReason: string | undefined;
  /** Provider response id for the final step, when reported. */
  readonly responseId: string | undefined;
  /** Actual provider model id for the final step, when reported. */
  readonly modelId: string | undefined;
  /** Non-fatal warnings reported for this step. */
  readonly warnings: readonly unknown[];
  /** Provider-owned metadata reported for this step. */
  readonly providerMetadata?: unknown;
}

/** Canonical managed `generate()` result shared by provider adapters. */
export interface GenerateResult<TRaw, TOutput = unknown> {
  /**
   * Exact ordered assistant output across all provider-call steps.
   *
   * This is the authoritative result. Use `text` only when a text projection
   * is sufficient; media, reasoning, and tool calls remain present here.
   *
   * @example
   * ```ts
   * const result = await runtime.generate(prompt, { model: 'model-id' })
   * for (const part of result.content) {
   *   if (part.type === 'image') renderImage(part.source)
   * }
   * console.log(result.text) // text parts only
   * ```
   */
  readonly content: readonly AssistantContentPart[];
  /** Text-only projection of {@link content}. */
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
  /** Ordered provider-call facts represented in this envelope. */
  readonly steps: readonly FinalStepInfo[];
  /** Facts from the final provider-call step. */
  readonly finalStep: FinalStepInfo;
  /** Provider-agnostic Crux message history. */
  readonly messages: readonly Message[];
  /** Non-fatal warnings accumulated in execution order. */
  readonly warnings: readonly unknown[];
  /** Provider-owned metadata from the terminal step, when supplied. */
  readonly providerMetadata?: unknown;
  /** Routing decisions for calls that used a routing wrapper. */
  readonly routing?: RoutingReceipt;
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
  /** Exact ordered assistant output for this step. */
  readonly content: readonly AssistantContentPart[];
  /** Usage reported by this step, if any. */
  readonly usage?: TokenUsage;
  /** Fully assembled tool calls reported by this step. */
  readonly toolCalls?: TraceMeta["toolCalls"];
  /** Provider finish reason, if any. */
  readonly finishReason: string | undefined;
  /** Provider response id, if any. */
  readonly responseId: string | undefined;
  /** Actual provider model id, if any. */
  readonly modelId: string | undefined;
  /** Non-fatal warnings reported for this step. */
  readonly warnings?: readonly unknown[];
  /** Provider-owned metadata reported for this step. */
  readonly providerMetadata?: unknown;
}

/** Fields supplied by the execution runtime when finalizing an envelope. */
export interface ResultEnvelopeBase<TRaw, TOutput = unknown> {
  /** Raw provider/SDK response for the terminal call. */
  readonly raw: TRaw;
  /** Provider-agnostic Crux message history. */
  readonly messages: readonly Message[];
  /** Trace metadata retained for observability plumbing. */
  readonly _meta: TraceMeta;
  /** Parsed structured output, when present. */
  readonly object?: TOutput;
  /** Public cost promoted from `_meta`. */
  readonly cost?: TraceMeta["cost"];
  /** Approval requests when execution suspended. */
  readonly pendingApprovals?: readonly ApprovalRequestInfo[];
  /** Routing decisions for calls that used a routing wrapper. */
  readonly routing?: RoutingReceipt;
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
      const publicSteps = Object.freeze(steps.map(finalStepInfo));
      const finalStep = publicSteps.at(-1) ?? emptyStepInfo();
      const content = Object.freeze(
        publicSteps.flatMap((step) => step.content),
      );
      return {
        content,
        text: textFromAssistantContent(content),
        ...(base.object !== undefined ? { object: base.object } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(base.cost !== undefined ? { cost: base.cost } : {}),
        steps: publicSteps,
        finalStep,
        messages: Object.freeze([...base.messages]),
        warnings: Object.freeze(publicSteps.flatMap((step) => step.warnings)),
        ...(finalStep.providerMetadata !== undefined
          ? { providerMetadata: finalStep.providerMetadata }
          : {}),
        ...(base.routing !== undefined ? { routing: base.routing } : {}),
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
      const publicSteps = Object.freeze(steps.map(finalStepInfo));
      const finalStep = publicSteps.at(-1) ?? emptyStepInfo();
      const content = Object.freeze(
        publicSteps.flatMap((step) => step.content),
      );
      return {
        content,
        text: textFromAssistantContent(content),
        ...(base.object !== undefined ? { object: base.object } : {}),
        ...(usage !== undefined ? { usage } : {}),
        ...(base.cost !== undefined ? { cost: base.cost } : {}),
        steps: publicSteps,
        finalStep,
        messages: Object.freeze([...base.messages]),
        warnings: Object.freeze(publicSteps.flatMap((step) => step.warnings)),
        ...(finalStep.providerMetadata !== undefined
          ? { providerMetadata: finalStep.providerMetadata }
          : {}),
        ...(base.routing !== undefined ? { routing: base.routing } : {}),
        ...(base.pendingApprovals
          ? { pendingApprovals: base.pendingApprovals }
          : {}),
      };
    },
  };
}

function finalStepInfo(step: ResultStepFacts | undefined): FinalStepInfo {
  if (!step) return emptyStepInfo();

  return Object.freeze({
    content: Object.freeze([...step.content]),
    text: textFromAssistantContent(step.content),
    ...(step.usage !== undefined ? { usage: step.usage } : {}),
    ...(step.toolCalls !== undefined ? { toolCalls: step.toolCalls } : {}),
    finishReason: step.finishReason,
    responseId: step.responseId,
    modelId: step.modelId,
    warnings: Object.freeze([...(step.warnings ?? [])]),
    ...(step.providerMetadata !== undefined
      ? { providerMetadata: step.providerMetadata }
      : {}),
  });
}

function emptyStepInfo(): FinalStepInfo {
  return Object.freeze({
    content: Object.freeze([]),
    text: "",
    finishReason: undefined,
    responseId: undefined,
    modelId: undefined,
    warnings: Object.freeze([]),
  });
}
