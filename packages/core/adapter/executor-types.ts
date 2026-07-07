/**
 * Types for the `LoopRuntimePort` contract — the adapter port for SDKs that
 * own their own tool loop (e.g. the Vercel AI SDK).
 *
 * Where `AdapterSpec` assumes core drives the loop one provider call at a
 * time, these types describe the inverse hand-off: core prepares a fully
 * resolved {@link ExecutorRequest}, the executor's SDK runs the multi-step
 * loop, and core steers each step through a {@link StepObserver} that
 * answers with a {@link StepDirective}.
 *
 * @module
 */

import type { z } from "zod";
import type { ModelInfo } from "../types";
import type { GenerationSettings, TraceMeta } from "../generation/types";
import type { SystemBlock } from "../resolver/types";
import type { DiagnosticsPort } from "../resolver/ports";
import type { Message } from "../generation/messages";
import type { JsonValue } from "../types/tool";
import type { ResultStepFacts } from "./result-accumulator";
import type { AdapterResponse } from "./types";

// ─────────────────────────────────────────────────────────────────
// Request
// ─────────────────────────────────────────────────────────────────

/**
 * A fully prepared generation request handed from `loopRuntimeAdapter()` to an
 * `LoopRuntimePort`.
 *
 * Everything policy-shaped has already happened by the time a spec sees
 * this object: the prompt is resolved, routing wrappers (`fallback()`,
 * `router()`, `cascade()`) are unwrapped to a concrete `model`, settings
 * are mapped through `mapSettings()`, and tools are merged, middleware-
 * wrapped, and instrumented. The spec's only job is to translate this
   * into its SDK's native arguments and run the call.
 *
 * @typeParam TModel - The SDK's model type (e.g. AI SDK `LanguageModel`).
 */
export interface ExecutorRequest<TModel> {
  /** The concrete model to call. Never a routing wrapper. */
  readonly model: TModel;
  /** Provider/model identity, from `describeModel()` — use for provider quirks. */
  readonly modelInfo: ModelInfo;
  /** Assembled system prompt text, when the prompt declares one. */
  readonly system: string | undefined;
  /**
   * System prompt as source-attributed blocks with provider-cache hints.
   * Specs that support native prompt caching (e.g. Anthropic cache
   * breakpoints) should prefer these over the joined `system` string.
   */
  readonly systemBlocks: readonly SystemBlock[] | undefined;
  /** Single-shot user prompt, mutually exclusive with `messages`. */
  readonly prompt: string | undefined;
  /** Conversation history in canonical Crux `Message` format. */
  readonly messages: readonly Message[] | undefined;
  /** Provider-native settings, already mapped via `mapSettings()`. */
  readonly settings: Record<string, unknown>;
  /**
   * Merged + instrumented tool map. Values keep whatever shape the caller
   * provided (AI SDK `tool()` objects pass through untouched); the factory
   * only wraps `execute`/`toModelOutput` for devtools.
   */
  readonly tools: Record<string, unknown> | undefined;
  /**
   * Backend-neutral approval evaluator for SDK-owned tool loops.
   *
   * SDK adapters adapt this to their native approval hook, but policy remains
   * resolved by core from context, prompt, call-site, and middleware inputs.
   */
  readonly toolApproval?: (
        call: {
          readonly toolName: string;
          readonly toolCallId: string;
          readonly input: unknown;
          readonly messages?: readonly Message[];
        },
      ) => boolean | PromiseLike<boolean>;
  /** Restrict which tools the model may call this run, when set. */
  readonly activeTools: readonly string[] | undefined;
  /**
   * Maximum loop steps the SDK may take. The spec must stop the loop at
   * this budget through native loop controls, adjusted
   * for any steps refunded via {@link StepDirective} `refundStep`.
   */
  readonly maxSteps: number;
  /**
   * Core's per-step steering hook. Call after every completed step and
   * apply the returned directive before the next step begins. See
   * {@link StepObserver} for the buffering contract.
   */
  readonly observer: StepObserver | undefined;
  /**
   * Cooperative cancellation from core's timeout policy. Pass to the SDK
   * (`abortSignal`) so a timed-out call stops consuming tokens.
   */
  readonly abortSignal: AbortSignal | undefined;
  /**
   * Adapter-specific passthrough options the factory does not interpret
   * (e.g. AI SDK `toolChoice`, custom `stopWhen` conditions).
   */
  readonly extra: Record<string, unknown> | undefined;
  /**
   * Non-fatal diagnostics channel for executor-level degradations that happen
   * after prompt resolution, such as SDK surface limitations.
   */
  readonly diagnostics?: DiagnosticsPort;
  /**
   * The safety streaming sub-protocol for `runStream()`. Set only on text
   * streams when guarded streaming applies; absent for `generate()` and
   * structured streams.
   *
   * When present, the spec MUST drive it: feed every outgoing text delta,
   * forward `emit` content to the consumer (which may differ from the fed
   * delta — held content released after an async fix, transformed text),
   * swallow `hold` directives, surface a thrown `GuardrailBlockedError` as
   * a stream error, and call `finish()` at end-of-stream, emitting the
   * seal's `pending` tail before closing. With the AI SDK, mount it via
   * `experimental_transform` on `streamText`.
   */
  readonly safety?: import("../safety/session").SafetyStream;
}

/**
 * A structured-output request: one {@link ExecutorRequest} plus the schema
 * the output must satisfy. Used with `attemptStructured()`, which performs
 * exactly one model attempt — the retry loop lives in core.
 */
export interface StructuredRequest<TModel> extends ExecutorRequest<TModel> {
  /** The Zod schema the prompt declared as its `output`. */
  readonly schema: z.ZodType;
}

// ─────────────────────────────────────────────────────────────────
// Step observation / steering
// ─────────────────────────────────────────────────────────────────

/** One completed step of an executor-driven loop, as reported to core. */
export interface ExecutorStep {
  /** Zero-based step index. Refunded steps do not advance the index seen by budgets. */
  readonly index: number;
  /** Assistant text produced in this step (may be empty for pure tool steps). */
  readonly text: string;
  /** Tool calls the model requested this step. */
  readonly toolCalls: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly args: unknown;
  }>;
  /** Results of tools the SDK executed this step. */
  readonly toolResults: ReadonlyArray<{
    readonly toolCallId: string;
    readonly toolName: string;
    readonly output: unknown;
  }>;
  /** The SDK's finish reason for this step, when reported. */
  readonly finishReason: string | undefined;
  /** Token usage for this step, when reported. */
  readonly usage: AdapterResponse["usage"] | undefined;
}

/**
 * Core's answer to a completed step — how `loopRuntimeAdapter()` steers a
 * loop it does not run.
 *
 * The contract is *observe step N, apply before step N+1*: an executor
 * must buffer an `amend` directive and apply it to the next model call
 * (AI SDK executors do this in `prepareStep`). A directive can never
 * rewrite the step that already happened.
 */
export type StepDirective =
  | {
      /** Proceed to the next step unchanged. The default when no observer is set. */
      readonly kind: "continue";
    }
  | {
      /** Stop the loop now; the current step's response becomes the final response. */
      readonly kind: "stop";
      /** Optional reason recorded in observability output. */
      readonly reason?: string;
    }
  | {
      /**
       * Amend the request before the next step. This is how core restores
       * mid-loop re-resolution (e.g. `LoadSkill` activating a skill whose
       * instructions must join the system prompt for subsequent steps).
       */
      readonly kind: "amend";
      /** Replacement system prompt for subsequent steps. */
      readonly system?: string;
      /** Replacement system blocks for subsequent steps. */
      readonly systemBlocks?: readonly SystemBlock[];
      /** Replacement tool map for subsequent steps (already instrumented). */
      readonly tools?: Record<string, unknown>;
      /** Replacement active-tool restriction for subsequent steps. */
      readonly activeTools?: readonly string[];
      /**
       * When `true`, the step that produced this directive does not count
       * against `maxSteps` — used for bookkeeping steps like `LoadSkill`
       * so loading a skill never costs the model a real working step.
       */
      readonly refundStep?: boolean;
    };

/**
 * Core's per-step steering hook, passed to `runLoop()` via
 * {@link ExecutorRequest.observer}.
 *
 * Executors must await the observer before starting the next step — the
 * directive may carry an amended system prompt or tool map that the next
 * step depends on.
 */
export interface StepObserver {
  /**
   * Called after each completed step.
   *
   * @param step - The step that just finished.
   * @returns The directive to apply before the next step.
   */
  onStepEnd(step: ExecutorStep): Promise<StepDirective>;
}

// ─────────────────────────────────────────────────────────────────
// Outcomes
// ─────────────────────────────────────────────────────────────────

/** Provider metadata extracted by the executor after a run. */
export interface ExecutorMeta {
  /** Total cost in USD, when the provider reports it (e.g. OpenRouter). */
  readonly costUsd?: number;
  /** Raw provider metadata for diagnostics; never interpreted by core. */
  readonly providerMetadata?: unknown;
}

/**
 * A tool call the SDK flagged as requiring approval, surfaced through the
 * `suspended` outcome. Core mints the approval id/token and owns the
 * resume protocol — the executor only reports what was suspended.
 */
export interface PendingToolApproval {
  readonly toolCallId: string;
  readonly toolName: string;
  /** The tool's input args, JSON-safe for persistence and display. */
  readonly input: JsonValue;
}

/**
 * The result of `runLoop()` — either a finished generation or a loop
 * suspended on tool approval.
 *
 * @remarks
 * - `complete`: the loop ran to a final response. `messages` is the full
 *   canonical history including every tool round, ready to persist or to
 *   feed into a follow-up call. `steps` counts budget-consuming steps
 *   (refunded steps excluded).
 * - `suspended`: a tool approval policy fired. The loop stopped
 *   *before executing* that tool; `assistantResponse` is the step that
 *   requested it, and `messages` ends just before the approval request —
 *   core appends the approval-request message itself after minting tokens.
 *
 * Provider errors are not an outcome — they throw, so core's fallback and
 * routing policy can classify and retry them.
 */
export type ExecutorOutcome<TRawResponse> =
  | {
      readonly status: "complete";
      /** The SDK's own result object, passed through untouched for consumers. */
      readonly raw: TRawResponse;
      /** Canonical extraction of the final response. */
      readonly response: AdapterResponse;
      /** Full canonical message history including tool rounds. */
      readonly messages: readonly Message[];
      /** Budget-consuming steps taken (refunds excluded). */
      readonly steps: number;
      /**
       * Exact provider-call facts reported by loop-owning SDKs.
       *
       * When supplied, core uses these for canonical envelope accumulation
       * instead of deriving step facts from observer callbacks or the final
       * aggregate response.
       */
      readonly stepFacts?: readonly ResultStepFacts[];
      /** Provider metadata (cost, etc.). */
      readonly meta: ExecutorMeta;
    }
  | {
      readonly status: "suspended";
      readonly reason: "tool-approval";
      /** The tool calls awaiting a decision. */
      readonly pendingApprovals: readonly PendingToolApproval[];
      /** The assistant step that requested the suspended tools. */
      readonly assistantResponse: AdapterResponse;
      /** Canonical history up to (not including) the approval request. */
      readonly messages: readonly Message[];
      /** Budget-consuming steps taken before suspension. */
      readonly steps: number;
    };

/**
 * The result of `attemptStructured()` — exactly one structured-output
 * attempt.
 *
 * Schema-validation failure is a *value*, not an exception: the executor
 * returns `invalid` with the raw text and Zod error so core can decide
 * whether to retry with corrective feedback, how many times, and what to
 * throw on exhaustion. Executors should still run their SDK's cheap text
 * repair (e.g. `experimental_repairText`) before declaring an attempt
 * invalid — that tier is mechanics, not policy.
 *
 * Provider/transport errors throw as usual.
 */
export type StructuredAttempt<TRawResponse> =
  | {
      readonly status: "ok";
      /** The SDK's own result object (e.g. `GenerateObjectResult`). */
      readonly raw: TRawResponse;
      /** Canonical extraction of the response. */
      readonly response: AdapterResponse;
      /** The parsed, schema-valid object. */
      readonly object: unknown;
    }
  | {
      readonly status: "invalid";
      /** The model's raw text that failed validation (best effort). */
      readonly rawText: string;
      /** Why validation failed. */
      readonly error: z.ZodError;
    };

// ─────────────────────────────────────────────────────────────────
// Streaming
// ─────────────────────────────────────────────────────────────────

/** Completion metadata resolved when an executor-driven stream finishes. */
export interface ExecutorStreamMeta extends TraceMeta {
  /** Final assistant text, when the stream produced text. */
  readonly text?: string;
  /** Stream timing metrics measured by the executor. */
  readonly streaming?: {
    /** Time to first token in milliseconds. */
    readonly ttftMs?: number;
    /** Output tokens per second over the whole stream. */
    readonly tokensPerSecond?: number;
    /** Total chunks observed. */
    readonly totalChunks?: number;
  };
}

/**
 * Handle returned by `runStream()`.
 *
 * `raw` is the SDK's own stream result (e.g. AI SDK `StreamTextResult`) and
 * is what consumers ultimately receive — the factory never wraps or
 * re-streams it, so single-consumption semantics are preserved.
 * `completion()` resolves once the stream finishes, with usage, cost, and
 * timing metrics; it must be safe to call before, during, or after the
 * consumer drains the stream, and must not itself consume the stream.
 */
export interface ExecutorStreamHandle<TRawStream> {
  /** The SDK stream result object, untouched. */
  readonly raw: TRawStream;
  /** Resolves with final metadata when the stream finishes. */
  completion: () => Promise<ExecutorStreamMeta | undefined>;
}
