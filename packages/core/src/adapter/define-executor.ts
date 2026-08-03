/**
 * `loopRuntimeAdapter()` — lower-level factory for loop-owned execution IR.
 *
 * The counterpart of `adapter()` for SDKs that drive their own multi-step
 * tool loop (e.g. the Vercel AI SDK). Accepts a {@link LoopRuntimePort} —
 * already bound to its SDK client — and returns a {@link CruxExecutor}.
 *
 * Provider packages should normally use
 * `defineProviderRuntime({ ownership: 'loop-owned', loop })`, which compiles
 * into this IR.
 *
 * The factory owns the entire policy layer so the port stays mechanical:
 * prompt resolution, routing dispatch (`fallback()`/`router()`/`cascade()`
 * are unwrapped *before* the port ever sees a model), validation retry,
 * constraints, guardrails, the tool-approval protocol, tool
 * instrumentation, timeouts, orchestration middleware/observability,
 * memory capture, and agent compositions.
 *
 * @module
 */

import type { AnyPrompt } from "../prompt/prompt-types";
import type { GenerationSettings } from "../generation/types";
import { Deadline, normalizeBudgetMs } from "../generation/timeout";
import type { LoopRuntimePort } from "./loop-runtime-port";
import { resolveModel } from "../routing/resolve";
import type { CallProfileParams } from "../routing";
import { createCompositions } from "../agent/create-compositions";
import { createAdapterExecution, sdkLoopDialect } from "./execution/session";
import type {
  CruxExecutor,
  ExecutorGenerateBaseOptions,
  ExecutorGenerateOptions,
  ExecutorGenerateResult,
  ExecutorStreamOptions,
  ExecutorStreamResult,
} from "./executor-contracts";
import { resolveModelCapacityProfile } from "../request/capacity/model-profile";
import {
  managedGenerationCheckpoint,
  managedGenerationStepBoundary,
} from "../generation-model/execution-checkpoint";
import { createLoopAgentExecutor } from "./execution/loop-agent-executor";

export type {
  CruxExecutor,
  ExecutorGenerateOptions,
  ExecutorGenerateResult,
  ExecutorModelArg,
  ExecutorStreamOptions,
  ExecutorStreamResult,
} from "./executor-contracts";

interface AttemptSignalOptions {
  readonly signal?: AbortSignal;
  readonly params?: CallProfileParams;
}

// ─────────────────────────────────────────────────────────────────
// loopRuntimeAdapter
// ─────────────────────────────────────────────────────────────────

/**
 * Create a loop-owning executor from a {@link LoopRuntimePort}.
 *
 * Returns a {@link CruxExecutor} — the mirror image of `adapter()` for SDKs
 * that run their own tool loop. Implement `AdapterSpec` when your SDK exposes
 * single-turn provider calls; implement `LoopRuntimePort` when it drives
 * multi-step generation itself (the Vercel AI SDK's `generateText` with
 * `stopWhen`, for example). The port is already bound to its SDK client, so
 * there is no separate client argument.
 *
 * Everything above the SDK call is handled here, identically to
 * `adapter()` and backed by the same `adapter/policy/*` modules: prompt
 * resolution, `fallback()`/`router()`/`cascade()` dispatch, validation
 * retry, constraints, guardrails, tool approvals, instrumentation,
 * timeouts, middleware, observability, memory capture, and the agent
 * compositions (`parallel`/`pipeline`/`consensus`/`swarm`).
 *
 * @param port - The loop runtime port. See {@link LoopRuntimePort}.
 * @returns A bound executor.
 *
 * @example
 * ```ts
 * import { loopRuntimeAdapter, fakeLoopRuntime } from '@use-crux/core/adapter'
 *
 * const fake = fakeLoopRuntime({ loops: [[{ text: 'hello' }]] })
 * const executor = loopRuntimeAdapter(fake.runtime)
 *
 * const result = await executor.generate(myPrompt, {
 *   model: 'fake:m-1',
 *   input: { instruction: 'Say hello' },
 *   validationRetry: { maxRetries: 2 },
 *   timeout: { totalMs: 30_000 },
 * })
 * ```
 */
export function loopRuntimeAdapter<
  TModel,
  TRawResponse = unknown,
  TRawStream = unknown,
>(
  port: LoopRuntimePort<TModel, TRawResponse, TRawStream>,
): CruxExecutor<TModel, TRawResponse, TRawStream> {
  type GenerateResult = ExecutorGenerateResult<TRawResponse>;
  const execution = createAdapterExecution(sdkLoopDialect(port));

  const modelLabel = (model: TModel): string => {
    const info = port.describeModel(model);
    return info.modelId || info.provider;
  };

  // ── generate() ──────────────────────────────────────────────

  async function generate(
    prompt: AnyPrompt,
    opts: ExecutorGenerateOptions<TModel>,
  ): Promise<GenerateResult> {
    const deadline = Deadline.after(opts.timeout?.totalMs);
    const runWithModel = (
      model: TModel,
      attemptOptions: AttemptSignalOptions = {},
    ): Promise<GenerateResult> =>
      generateSingle(
        prompt,
        opts,
        model,
        deadline.compose(attemptOptions.signal),
        attemptOptions.params,
      );

    try {
      return await resolveModel<TModel, GenerateResult>(
        opts.model as TModel,
        opts.input ?? {},
        runWithModel,
        modelLabel,
        {
          deadline,
          mode: "generate",
          signal: opts.signal,
          context: opts.routing,
          forcedRoute: opts.route,
        },
      );
    } finally {
      deadline.dispose();
    }
  }

  async function generateSingle(
    prompt: AnyPrompt,
    opts: ExecutorGenerateOptions<TModel>,
    model: TModel,
    signal: AbortSignal | undefined,
    params: CallProfileParams | undefined,
  ): Promise<GenerateResult> {
    const nativeMessages = (
      opts as { readonly nativeMessages?: readonly unknown[] }
    ).nativeMessages;
    return (await execution.generate({
      prompt,
      model,
      input: opts.input,
      tools: opts.tools,
      toolsContext: opts.toolsContext,
      runtimeContext: opts.runtimeContext,
      toolMiddleware: opts.toolMiddleware,
      toolApproval: opts.toolApproval,
      messages: opts.messages,
      nativeMessages,
      maxSteps: opts.maxSteps,
      settings: mergeSettings(params, opts.settings),
      inputBudget: opts.inputBudget,
      prepareStep: opts.prepareStep,
      timeout: opts.timeout,
      validationRetry: opts.validationRetry,
      constraints: opts.constraints,
      constraintMaxRetries: opts.constraintMaxRetries,
      guardrails: opts.guardrails,
      safety: opts.safety,
      observer: opts.observer,
      activeTools: opts.activeTools,
      extra: opts.extra,
      signal,
      [managedGenerationCheckpoint]: opts[managedGenerationCheckpoint],
      [managedGenerationStepBoundary]: opts[managedGenerationStepBoundary],
    })) as GenerateResult;
  }

  // ── stream() ────────────────────────────────────────────────

  async function streamFn(
    prompt: AnyPrompt,
    opts: ExecutorStreamOptions<TModel>,
  ): Promise<ExecutorStreamResult<TRawStream>> {
    const deadline = Deadline.after(opts.timeout?.totalMs);
    const runWithModel = (
      model: TModel,
      attemptOptions: AttemptSignalOptions = {},
    ): Promise<ExecutorStreamResult<TRawStream>> =>
      streamSingle(
        prompt,
        opts,
        model,
        deadline.compose(attemptOptions.signal),
        attemptOptions.params,
      );

    try {
      return await resolveModel<TModel, ExecutorStreamResult<TRawStream>>(
        opts.model as TModel,
        opts.input ?? {},
        runWithModel,
        modelLabel,
        {
          deadline,
          mode: "stream",
          signal: opts.signal,
          firstTokenMs: normalizeBudgetMs(opts.timeout?.firstToken),
          context: opts.routing,
          forcedRoute: opts.route,
        },
      );
    } finally {
      deadline.dispose();
    }
  }

  async function streamSingle(
    prompt: AnyPrompt,
    opts: ExecutorStreamOptions<TModel>,
    model: TModel,
    signal: AbortSignal | undefined,
    params: CallProfileParams | undefined,
  ): Promise<ExecutorStreamResult<TRawStream>> {
    const nativeMessages = (
      opts as { readonly nativeMessages?: readonly unknown[] }
    ).nativeMessages;
    return (await execution.stream({
      prompt,
      model,
      input: opts.input,
      tools: opts.tools,
      toolsContext: opts.toolsContext,
      runtimeContext: opts.runtimeContext,
      toolMiddleware: opts.toolMiddleware,
      toolApproval: opts.toolApproval,
      messages: opts.messages,
      nativeMessages,
      maxSteps: opts.maxSteps,
      settings: mergeSettings(params, opts.settings),
      inputBudget: opts.inputBudget,
      prepareStep: opts.prepareStep,
      timeout: opts.timeout,
      validationRetry: opts.validationRetry,
      constraints: opts.constraints,
      constraintMaxRetries: opts.constraintMaxRetries,
      guardrails: opts.guardrails,
      safety: opts.safety,
      observer: opts.observer,
      activeTools: opts.activeTools,
      extra: opts.extra,
      signal,
    })) as ExecutorStreamResult<TRawStream>;
  }

  // ── Agent executor + compositions ───────────────────────────

  const agentExecutor = createLoopAgentExecutor(generate);

  const compositions = createCompositions(agentExecutor);

  return Object.freeze({
    executorId: port.id,
    capacity: (model: TModel) => {
      const info = port.describeModel(model);
      return resolveModelCapacityProfile(
        info.modelId,
        port.capacity ? () => port.capacity!(info) : undefined,
      );
    },
    generate,
    stream: streamFn,
    parallel: compositions.parallel,
    pipeline: compositions.pipeline,
    consensus: compositions.consensus,
    swarm: compositions.swarm,
  });
}

function mergeSettings(
  params: CallProfileParams | undefined,
  settings: GenerationSettings | undefined,
): GenerationSettings | undefined {
  if (params === undefined) return settings;
  return { ...params, ...settings };
}
