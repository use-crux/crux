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
import type { GenerationMeta, TokenUsage } from "../generation/types";
import type { WithOperationResultMeta } from "../observability/result-meta";
import type { AssistantContentPart } from "../types/content";
import { textFromAssistantContent } from "./assistant-output";
import type { ApprovalRequestInfo } from "./tool/approval";
import type { RoutingReceipt } from "../routing/receipt";
import { sumUsageWhenComplete } from "./result-usage";
import type { CruxRunId } from "../observability";
import type { StreamCompletionPayload } from "./stream-result-types";
import type { RequestReceipt } from "../request/receipt/receipt";
import { recordRequestRetryCount } from "../request/receipt/receipt";
import type { ThreadCommit } from "../thread/types";

export { createStreamResult } from "./result-stream";
export { sumUsageWhenComplete } from "./result-usage";
export type {
  StreamCompletion,
  StreamCompletionPayload,
} from "./stream-result-types";
export type { StreamResult } from "./logical-stream";

/** Last provider-call step facts exposed next to accumulated result fields. */
export interface FinalStepInfo {
  /** Sealed request evidence for this provider-call step. */
  readonly request?: RequestReceipt;
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
  readonly toolCalls?: GenerationMeta["toolCalls"];
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

/**
 * Provider-neutral generation payload assembled before core operation stamping.
 *
 * Adapter execution owns provider facts such as `responseId`; it does not own
 * or manufacture the enclosing Crux operation's `traceId` and `spanId`.
 */
export interface GenerateResultPayload<TRaw, TOutput = unknown> {
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
  readonly cost?: GenerationMeta["cost"];
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
  /** Atomic canonical Thread publication produced by this invocation. */
  readonly threadCommit?: ThreadCommit;
  /** Raw provider or SDK response object. */
  readonly raw: TRaw;
  /** Provider-neutral facts accumulated during generation. */
  readonly _meta: GenerationMeta;
}

/** Provider-neutral generate payload before run and operation stamping. */
export type GenerateResultWithoutRunId<TRaw, TOutput = unknown> =
  GenerateResultPayload<TRaw, TOutput>;
/**
 * Canonical managed generation result finalized by the core operation owner.
 *
 * Provider and adapter execution code creates a {@link GenerateResultPayload};
 * the enclosing `generation.call` operation adds exact trace and span identity
 * before hooks and callers observe the result.
 *
 * @example
 * ```ts
 * const result = await adapter.generate(prompt, options)
 * console.log(result._meta.traceId, result._meta.spanId)
 * console.log(result._meta.responseId) // provider identity, when supplied
 * ```
 */
export type GenerateResult<TRaw, TOutput = unknown> =
  WithOperationResultMeta<GenerateResultPayload<TRaw, TOutput>> &
  Readonly<{ runId: CruxRunId }>;

/** One provider-call step that participates in envelope accumulation. */
export interface ResultStepFacts {
  /** Sealed request evidence for this provider-call step. */
  readonly request?: RequestReceipt;
  /** Exact ordered assistant output for this step. */
  readonly content: readonly AssistantContentPart[];
  /** Usage reported by this step, if any. */
  readonly usage?: TokenUsage;
  /** Fully assembled tool calls reported by this step. */
  readonly toolCalls?: GenerationMeta["toolCalls"];
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
  /** Additional transport attempts made for this sealed request. */
  readonly transportRetries?: number;
}

/** Fields supplied by the execution runtime when finalizing an envelope. */
export interface ResultEnvelopeBase<TRaw, TOutput = unknown> {
  /** Raw provider/SDK response for the terminal call. */
  readonly raw: TRaw;
  /** Provider-agnostic Crux message history. */
  readonly messages: readonly Message[];
  /** Provider-neutral facts available before operation correlation. */
  readonly _meta: GenerationMeta;
  /** Parsed structured output, when present. */
  readonly object?: TOutput;
  /** Public cost promoted from `_meta`. */
  readonly cost?: GenerationMeta["cost"];
  /** Approval requests when execution suspended. */
  readonly pendingApprovals?: readonly ApprovalRequestInfo[];
  /** Atomic canonical Thread publication produced by this invocation. */
  readonly threadCommit?: ThreadCommit;
  /** Routing decisions for calls that used a routing wrapper. */
  readonly routing?: RoutingReceipt;
  /**
   * Scalar totals across every billable physical attempt (RFC #173, law 7).
   *
   * When present this REPLACES the step-derived usage and the supplied cost —
   * including replacing them with `undefined`, which is how "some billable
   * attempt was unmetered, so the total is unknowable" is expressed. Step facts
   * are untouched, so `usage` deliberately stops equalling the sum of
   * `steps[].usage` once a policy retry occurred.
   */
  readonly logicalTotals?: {
    readonly usage?: TokenUsage;
    readonly cost?: number;
  };
}

/** Create a new result accumulator for one managed call. */
export function createResultAccumulator() {
  const steps: ResultStepFacts[] = [];

  return {
    /** Record one provider-call step after Crux policy has finalized its facts. */
    addStep(facts: ResultStepFacts): void {
      if (facts.request) {
        recordRequestRetryCount(facts.request, facts.transportRetries);
      }
      steps.push(facts);
    },

    /** Finalize all recorded step facts into the canonical `generate()` envelope. */
    finalize<TRaw, TOutput = unknown>(
      base: ResultEnvelopeBase<TRaw, TOutput>,
    ): GenerateResultPayload<TRaw, TOutput> {
      const usage = base.logicalTotals
        ? base.logicalTotals.usage
        : sumUsageWhenComplete(steps);
      const cost = base.logicalTotals ? base.logicalTotals.cost : base.cost;
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
        ...(cost !== undefined ? { cost } : {}),
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
        ...(base.threadCommit ? { threadCommit: base.threadCommit } : {}),
        raw: base.raw,
        _meta: base._meta,
      };
    },

    /** Finalize all recorded step facts into a canonical stream completion. */
    finalizeCompletion<TOutput = unknown>(
      base: Omit<ResultEnvelopeBase<never, TOutput>, "raw">,
    ): StreamCompletionPayload<TOutput> {
      const usage = base.logicalTotals
        ? base.logicalTotals.usage
        : sumUsageWhenComplete(steps);
      const cost = base.logicalTotals ? base.logicalTotals.cost : base.cost;
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
        ...(cost !== undefined ? { cost } : {}),
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
        ...(base.threadCommit ? { threadCommit: base.threadCommit } : {}),
        _meta: base._meta,
      };
    },
  };
}

function finalStepInfo(step: ResultStepFacts | undefined): FinalStepInfo {
  if (!step) return emptyStepInfo();

  return Object.freeze({
    ...(step.request !== undefined ? { request: step.request } : {}),
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
