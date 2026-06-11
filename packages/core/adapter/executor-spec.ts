/**
 * `ExecutorSpec` — the adapter contract for SDKs that own their own tool loop.
 *
 * Crux has two adapter dialects:
 *
 * - {@link AdapterSpec} (`adapter()`): for raw provider SDKs (Anthropic,
 *   OpenAI, Google). Core drives the tool loop one `call()` at a time and
 *   the spec formats tool rounds.
 * - `ExecutorSpec` (`executorAdapter()`): for orchestrating SDKs like the
 *   Vercel AI SDK that run their own multi-step loop. The spec hands the
 *   loop to the SDK and core steers per step through a `StepObserver`.
 *
 * Implement whichever matches your SDK's shape — never both. In either
 * dialect, core owns the policy layer: prompt resolution, routing
 * (`fallback()`/`router()`/`cascade()`), validation retry, constraints,
 * guardrails, the approval protocol, tool instrumentation, timeouts, and
 * observability. A spec implements mechanics only.
 *
 * @module
 */

import type { z } from 'zod'
import type { GenerationSettings, ModelInfo } from '../types'
import type { AdapterSpec } from './spec'
import type {
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorStreamHandle,
  ExecutorStreamMeta,
  StructuredAttempt,
  StructuredRequest,
} from './executor-types'

/**
 * The loop-owning adapter contract.
 *
 * An `ExecutorSpec` translates fully prepared {@link ExecutorRequest}s into
 * its SDK's native calls. It never resolves prompts, never unwraps routing
 * wrappers, never decides retry policy — by the time a request reaches the
 * spec, `executorAdapter()` has done all of that.
 *
 * The three run methods divide the work by output mode:
 *
 * - {@link runLoop} — multi-step text + tools. The SDK owns the loop
 *   (e.g. `generateText` with `stopWhen`); core steers per step via
 *   `request.observer` and receives a complete-or-suspended outcome.
 * - {@link attemptStructured} — exactly ONE structured-output attempt.
 *   Schema failures come back as the `invalid` variant instead of throwing,
 *   which is what lets core own the corrective-retry loop. Cheap SDK-side
 *   text repair (e.g. `experimental_repairText`) belongs inside the attempt.
 * - {@link runStream} — streaming for both text and structured output,
 *   returning the SDK's stream result untouched plus a typed completion.
 *
 * Provider/transport errors always throw — core's fallback and routing
 * policy classifies and retries them.
 *
 * @typeParam TClient - The SDK's client/configuration type. For SDKs with
 *   module-level entry points (like the AI SDK), this is typically a small
 *   gateway object owning those calls — which is also the test seam.
 * @typeParam TModel - The SDK's model type (e.g. AI SDK `LanguageModel`).
 * @typeParam TRawResponse - The SDK's result type for non-streaming calls.
 * @typeParam TRawStream - The SDK's result type for streaming calls.
 *
 * @example
 * ```ts
 * import { executorAdapter } from '@crux/core/adapter'
 *
 * const createMyExecutor = executorAdapter({
 *   executorId: 'my-sdk',
 *   describeModel: (model) => ({ provider: model.provider, modelId: model.id }),
 *   mapSettings: (settings) => ({ temperature: settings.temperature }),
 *   runLoop: async (client, request) => { ... },
 *   attemptStructured: async (client, request) => { ... },
 *   runStream: async (client, request) => { ... },
 * })
 *
 * const executor = createMyExecutor(client)
 * const result = await executor.generate(myPrompt, { model, input: { ... } })
 * ```
 */
export interface ExecutorSpec<TClient, TModel, TRawResponse = unknown, TRawStream = unknown> {
  /** Executor identifier used in observability and provider matching (e.g. `'ai-sdk'`). */
  readonly executorId: string

  /**
   * Extract provider/model identity from an SDK model reference.
   *
   * Called before prompt resolution so prompts can adapt per provider, and
   * again for provider-quirk decisions (schema sanitization, cache hints).
   * Must be cheap and side-effect free.
   */
  describeModel(model: TModel): ModelInfo

  /**
   * Map canonical {@link GenerationSettings} to the SDK's native option
   * names. Receives the model's identity so provider-specific renames can
   * happen here rather than leaking into request construction.
   */
  mapSettings(settings: GenerationSettings, model: ModelInfo): Record<string, unknown>

  /**
   * Run a multi-step text + tools generation. The SDK owns the loop.
   *
   * Contract highlights (verified by `executorSpecConformance()`):
   * - Stop at `request.maxSteps`, plus any steps refunded via directives.
   * - After every step, await `request.observer?.onStepFinish(step)` and
   *   apply the directive *before* the next step starts (`stop` ends the
   *   loop; `amend` swaps system/tools for subsequent steps; `refundStep`
   *   returns the step to the budget).
   * - When a tool requires approval, do not execute it — return the
   *   `suspended` outcome instead.
   * - Pass `request.abortSignal` to the SDK for cooperative timeout.
   */
  runLoop(client: TClient, request: ExecutorRequest<TModel>): Promise<ExecutorOutcome<TRawResponse>>

  /**
   * Make exactly one structured-output attempt against the schema.
   *
   * Return the `invalid` variant — never throw — when the model's output
   * fails schema validation, including the raw text so core can quote it
   * in corrective feedback. Run the SDK's cheap text-repair tier inside
   * the attempt before declaring it invalid.
   */
  attemptStructured(client: TClient, request: StructuredRequest<TModel>): Promise<StructuredAttempt<TRawResponse>>

  /**
   * Run a streaming generation (text, or structured when `schema` is set).
   *
   * The returned handle's `raw` must be the SDK's own stream result,
   * untouched — consumers iterate it directly. `completion()` must resolve
   * from SDK finish callbacks, never by consuming the stream itself.
   */
  runStream(
    client: TClient,
    request: ExecutorRequest<TModel> & { readonly schema?: z.ZodType },
  ): Promise<ExecutorStreamHandle<TRawStream>>

  /**
   * Recreate a stream handle from a cached (semantic-cache) result, when
   * the executor supports cached replay. Optional: without it, cache
   * middleware falls back to live generation for streams.
   *
   * @param cached - The cached payload captured from a prior run.
   */
  replayStream?(cached: {
    readonly text?: string
    readonly object?: unknown
    readonly meta?: Record<string, unknown>
  }): ExecutorStreamHandle<TRawStream>
}

/** Convenience re-exports so spec implementations import from one place. */
export type {
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorStreamHandle,
  ExecutorStreamMeta,
  StructuredAttempt,
  StructuredRequest,
}
