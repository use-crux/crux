/**
 * `LoopRuntimePort` — the deep, gateway-closed execution boundary for SDKs
 * that own their own multi-step model/tool loop.
 *
 * Crux has two adapter dialects:
 *
 * - {@link AdapterSpec} (`adapter()`): for raw provider SDKs (Anthropic,
 *   OpenAI, Google). Core drives the tool loop one `call()` at a time and
 *   the spec formats tool rounds.
 * - `LoopRuntimePort` (`loopRuntimeAdapter()`): for orchestrating SDKs like
 *   the Vercel AI SDK that run their own multi-step loop. The port hands the
 *   loop to the SDK and core steers per step through a `StepObserver`.
 *
 * The port is **already bound to its SDK client/gateway** — the run methods
 * take only a prepared {@link ExecutorRequest}, never a client. Provider
 * packages author `defineProviderRuntime({ ownership: 'loop-owned', loop })`
 * and core compiles that contract into a `LoopRuntimePort`; `@use-crux/ai` is
 * the only package that translates a `LoopRuntimePort` to AI SDK calls.
 *
 * @module
 */

import type { z } from "zod";
import type { ModelInfo } from "../types";
import type { GenerationSettings } from "../generation/types";
import type { AdapterSpec } from "./spec";
import type { ProviderMediaHooks } from "./native-chat/media-hooks";
import type { ToolSourceMaterializer } from "../tools/tool-source";
import type { StructuredOutputCapabilities } from "./structured-output";
import type {
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorProviderStreamHandle,
  ExecutorStreamCompletionPayload,
  StructuredAttempt,
  StructuredRequest,
} from "./executor-types";
import {
  toolModelIngressDialect,
  type ToolModelIngressDialect,
} from "./tool/model-ingress-port";

/**
 * A cached generation payload captured from a prior run, used to recreate a
 * stream handle for semantic-cache replay without re-calling the provider.
 */
export interface CachedStreamPayload {
  /** Cached final text, for text streams. */
  readonly text?: string;
  /** Cached parsed object, for structured streams. */
  readonly object?: unknown;
  /** Cached trace metadata to surface on the replayed completion. */
  readonly meta?: Record<string, unknown>;
}

/**
 * The loop-owning adapter contract, bound to one SDK client.
 *
 * A `LoopRuntimePort` translates fully prepared {@link ExecutorRequest}s into
 * its SDK's native calls. It never resolves prompts, never unwraps routing
 * wrappers, never decides retry policy — by the time a request reaches the
 * port, `loopRuntimeAdapter()` has done all of that. The SDK client (or a
 * small gateway object owning the SDK's module-level calls) is closed over
 * when the port is created, so each run method takes only the request.
 *
 * The three run methods divide the work by output mode:
 *
 * - {@link runTextLoop} — multi-step text + tools. The SDK owns the loop
 *   (e.g. `generateText` with `stopWhen`); core steers per step via
 *   `request.observer` and receives a complete-or-suspended outcome.
 * - {@link runStructuredAttempt} — exactly ONE structured-output attempt.
 *   Schema failures come back as the `invalid` variant instead of throwing,
 *   which is what lets core own the corrective-retry loop. Cheap SDK-side
 *   text repair (e.g. `experimental_repairText`) belongs inside the attempt.
 * - {@link runStream} — streaming for both text and structured output,
 *   returning the SDK's stream result untouched plus a typed completion.
 *
 * Provider/transport errors always throw — core's fallback and routing
 * policy classifies and retries them.
 *
 * @typeParam TModel - The SDK's model type (e.g. AI SDK `LanguageModel`).
 * @typeParam TRawResponse - The SDK's result type for non-streaming calls.
 * @typeParam TRawStream - The SDK's result type for streaming calls.
 *
 * @example
 * ```ts
 * import { loopRuntimeAdapter } from '@use-crux/core/adapter'
 *
 * const executor = loopRuntimeAdapter(myLoopRuntimePort)
 * const result = await executor.generate(myPrompt, { model, input: { ... } })
 * ```
 */
export interface LoopRuntimePort<
  TModel,
  TRawResponse = unknown,
  TRawStream = unknown,
> {
  /** Runtime identifier used in observability and provider matching (e.g. `'ai-sdk'`). */
  readonly id: string;

  /** Explicit timing guarantees implemented by this loop-owning runtime. */
  readonly capabilities?: {
    /** The runtime applies `request.stepTransformer` before SDK/Crux client tools. */
    readonly stepTransform?: "before-client-tools";
    /**
     * The runtime executes `request.streamPlan`: it can discard a rejected attempt
     * without surfacing any of it and restream, composing one logical result across
     * attempts (RFC #173). Core only sends a plan to runtimes that declare this;
     * others keep the single-attempt path, where a commit-gate rejection fails closed.
     */
    readonly coordinatedStream?: true;
  };

  /** Provider-authored media validation consumed privately before SDK I/O. */
  readonly media?: ProviderMediaHooks;

  /** Materialize an inert prompt tool source for one SDK-loop invocation. */
  readonly materializeToolSource?: ToolSourceMaterializer;

  /** @internal Guard client-tool output through the runtime's native dialect. */
  readonly [toolModelIngressDialect]?: ToolModelIngressDialect;

  /**
   * Resolve the inert structured-output capabilities the selected model
   * accepts. The resolver only selects declared capability data — it must not
   * compile or rewrite schemas. Core resolves capabilities for the request's
   * model, compiles the plan once, and installs `plan.outputSchema` as the
   * runtime's wire schema.
   *
   * Return `undefined` for a model whose structured-output semantics cannot be
   * guaranteed; core then fails before transport with an actionable
   * unsupported-structured-output error rather than inventing a default.
   */
  readonly structuredOutput?: {
    capabilities(model: ModelInfo): StructuredOutputCapabilities | undefined;
  };

  /**
   * Extract provider/model identity from an SDK model reference.
   *
   * Called before prompt resolution so prompts can adapt per provider, and
   * again for provider-quirk decisions (schema sanitization, cache hints).
   * Must be cheap and side-effect free.
   */
  describeModel(model: TModel): ModelInfo;

  /**
   * Map canonical {@link GenerationSettings} to the SDK's native option
   * names. Receives the model's identity so provider-specific renames can
   * happen here rather than leaking into request construction.
   */
  mapSettings(
    settings: GenerationSettings,
    model: ModelInfo,
  ): Record<string, unknown>;

  /**
   * Run a multi-step text + tools generation. The SDK owns the loop.
   *
   * Contract highlights (verified by `loopRuntimePortConformance()`):
   * - Stop at `request.maxSteps`, plus any steps refunded via directives.
   * - After every step, await `request.observer?.onStepEnd(step)` and
   *   apply the directive *before* the next step starts (`stop` ends the
   *   loop; `amend` swaps system/tools for subsequent steps; `refundStep`
   *   returns the step to the budget).
   * - When a tool requires approval, do not execute it — return the
   *   `suspended` outcome instead.
   * - Pass `request.abortSignal` to the SDK for cooperative timeout.
   */
  runTextLoop(
    request: ExecutorRequest<TModel>,
  ): Promise<ExecutorOutcome<TRawResponse>>;

  /**
   * Make exactly one structured-output attempt against the schema.
   *
   * Return the `invalid` variant — never throw — when the model's output
   * fails schema validation, including the raw text so core can quote it
   * in corrective feedback. Run the SDK's cheap text-repair tier inside
   * the attempt before declaring it invalid.
   */
  runStructuredAttempt(
    request: StructuredRequest<TModel>,
  ): Promise<StructuredAttempt<TRawResponse>>;

  /**
   * Run a streaming generation (text, or structured when `schema` is set).
   *
   * The returned handle's `raw` must be the SDK's own stream result, untouched —
   * consumers iterate it directly. `completion()` must resolve from SDK finish
   * callbacks, never by consuming the stream itself.
   *
   * Exception: when `request.streamPlan?.active` is true (a commit gate can reject an
   * attempt, RFC #173), a literal single-attempt object is impossible because a rejected
   * attempt must be discarded and restreamed. `raw` is then SDK-SHAPED but may be a
   * runtime-composed logical stream spanning attempts rather than object-identical to one
   * provider attempt. It must still preserve the supported result surface and semantics:
   * `textStream`, `fullStream`, the completion promises/getters Crux reads, structured
   * output/object, usage, finish reason, response messages, warnings, provider metadata,
   * cancellation, and error propagation.
   */
  runStream(
    request: ExecutorRequest<TModel> & { readonly schema?: z.ZodType },
  ): Promise<ExecutorProviderStreamHandle<TRawStream>>

  /**
   * Recreate a stream handle from a cached (semantic-cache) result, when
   * the runtime supports cached replay. Optional: without it, cache
   * middleware falls back to live generation for streams.
   *
   * @param cached - The cached payload captured from a prior run.
   */
  replayStream?(cached: CachedStreamPayload): ExecutorProviderStreamHandle<TRawStream>
}

/**
 * The client-dependent operations of a {@link LoopRuntimePort}: everything a
 * provider's `bind(client)` must supply, minus the static identity/settings
 * hooks that core already holds on the loop contract.
 *
 * Authoring `defineProviderRuntime({ loop })` returns this from `bind`; core
 * combines it with `describeModel`/`settings`/`id` to assemble the full port.
 */
export type BoundLoopRuntime<
  TModel,
  TRawResponse = unknown,
  TRawStream = unknown,
> = Omit<
  LoopRuntimePort<TModel, TRawResponse, TRawStream>,
  "id" | "describeModel" | "mapSettings"
>;

/** Convenience re-exports so port implementations import from one place. */
export type {
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorProviderStreamHandle,
  ExecutorStreamCompletionPayload,
  StructuredAttempt,
  StructuredRequest,
};
