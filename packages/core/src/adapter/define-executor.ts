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
import { Deadline } from "../generation/timeout";
import type { TimeoutOptions } from "../generation/timeout";
import type { Message } from "../generation/messages";
import type { LoopRuntimePort } from "./loop-runtime-port";
import type { ExecutorStreamHandle, StepObserver } from "./executor-types";
import type { GenerateResult } from "./result-accumulator";
import type { ValidationRetryOptions } from "../generation/validation-retry";
import type { Constraint } from "../safety/constraint/types";
import type { Guardrail } from "../safety/guardrail/types";
import type { SafetyTuneOptions } from "../safety/tune";
import type { FallbackModel } from "../generation/fallback";
import { resolveModel } from "../routing/resolve";
import type {
  AnyRouterModel,
  CascadeModel,
  RetryModel,
  SplitModel,
  CallProfileParams,
  RoutingCallOptions,
} from "../routing";
import type { ToolMiddleware } from "../tools/types";
import type { ToolApprovalMap } from "../tools/approval-policy";
import { createCompositions } from "../agent/create-compositions";
import { agentRoutingContext } from "../agent/routing-context";
import type { AgentExecutor } from "../agent/executor";
import { getExecutionContext } from "../runtime/execution-context";
import { createAdapterExecution, sdkLoopDialect } from "./execution/session";

interface AttemptSignalOptions {
  readonly signal?: AbortSignal;
  readonly params?: CallProfileParams;
}

// ─────────────────────────────────────────────────────────────────
// Options & results
// ─────────────────────────────────────────────────────────────────

/**
 * The model argument accepted by executor `generate()`/`stream()`: a plain
 * SDK model or any core routing wrapper around one. Routing is resolved by
 * the factory; the spec only ever receives a plain `TModel`.
 */
export type ExecutorModelArg<TModel> =
  | TModel
  | FallbackModel<TModel>
  | AnyRouterModel<TModel>
  | CascadeModel<TModel>
  | SplitModel<Record<string, { model: TModel; weight: number }>>
  | RetryModel<TModel>;

/** Shared fields for executor `generate()` calls. */
export interface ExecutorGenerateBaseOptions<TModel, TSelectedModel = ExecutorModelArg<TModel>> {
  /** The model to use — plain, `fallback()`, `router()`, or `cascade()`. */
  model: TSelectedModel;
  /** Input for the prompt. */
  input?: Record<string, unknown>;
  /** Additional tools merged at call time (highest precedence). */
  tools?: Record<string, unknown>;
  /** Per-tool context values keyed by tools that declare `contextSchema`. */
  toolsContext?: Readonly<Record<string, unknown>>;
  /** Shared context threaded through tool execution, middleware, approvals, and step hooks. */
  runtimeContext?: unknown;
  /** Tool middleware applied after prompt tools and call-site tools are merged. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[];
  /** Call-site approval policy with final-word precedence over prompt/context declarations. */
  toolApproval?: ToolApprovalMap;
  /**
   * Message history override — used for conversation continuations and for
   * resuming after a tool-approval decision (append a
   * `tool-approval-response` message to the suspended result's history).
   */
  messages?: Message[];
  /** Maximum loop steps. Refunded steps (e.g. `LoadSkill`) don't count. @defaultValue 10 */
  maxSteps?: number;
  /** Call-site generation settings (highest precedence). */
  settings?: GenerationSettings;
  /** Token budget for the system message. */
  tokenBudget?: number;
  /** Structured timeout budgets for this managed call. */
  timeout?: TimeoutOptions;
  /**
   * Validation-feedback retry for structured output. Each retry makes one
   * additional `attemptStructured` call with the Zod errors injected as a
   * corrective message.
   */
  validationRetry?: ValidationRetryOptions;
  /** Semantic constraints checked after structural validation passes. */
  constraints?: Constraint[];
  /** Shared cap on total constraint retries across all constraints. */
  constraintMaxRetries?: number;
  /** Guardrails to run on input/output during generation. */
  guardrails?: Guardrail[];
  /**
   * Per-call safety posture overrides keyed by policy id.
   *
   * Tune enforcement/reporting, stream posture, or whether a policy is
   * enabled for this call without replacing the policy logic.
   */
  safety?: SafetyTuneOptions;
  /**
   * Per-step steering observer. Runs after the factory's own steering
   * (skill re-resolution); on conflict, `stop` wins over `amend` wins over
   * `continue`, and caller `amend` fields override factory ones.
   */
  observer?: StepObserver;
  /** Restrict which tools the model may call. */
  activeTools?: readonly string[];
  /** Spec-specific passthrough options (e.g. AI SDK `toolChoice`). */
  extra?: Record<string, unknown>;
}

/** Options for executor `generate()` calls. */
export type ExecutorGenerateOptions<
  TModel,
  TSelectedModel = ExecutorModelArg<TModel>,
> = ExecutorGenerateBaseOptions<TModel, TSelectedModel> &
  RoutingCallOptions<TSelectedModel>;

/** Options for executor `stream()` calls. */
export type ExecutorStreamOptions<
  TModel,
  TSelectedModel = ExecutorModelArg<TModel>,
> = ExecutorGenerateOptions<TModel, TSelectedModel>;

/**
 * Result of an executor `generate()` call.
 *
 * Suspension is signalled in-band, mirroring `adapter()`: when a tool
 * required approval, `_meta.finishReason` is `'tool_approval_required'`,
 * `pendingApprovals` carries the minted requests, and `messages` ends with
 * the approval-request message — persist it, collect a decision, append a
 * `tool-approval-response`, and call `generate()` again with `messages`.
 */
export type ExecutorGenerateResult<TRawResponse> = GenerateResult<
  TRawResponse | undefined
>;

/** The executor interface returned by the factory. */
export interface CruxExecutor<
  TModel,
  TRawResponse = unknown,
  TRawStream = unknown,
> {
  /** Executor identifier from the port. */
  readonly executorId: string;

  /** Execute a prompt (non-streaming) through the SDK-owned loop. */
  generate(
    prompt: AnyPrompt,
    opts: ExecutorGenerateOptions<TModel>,
  ): Promise<ExecutorGenerateResult<TRawResponse>>;

  /**
   * Stream a prompt. Returns the SDK's stream result untouched (`raw`)
   * plus a typed `completion()` resolving with usage/cost/timing metadata.
   * `cascade()` models are rejected — tier evaluation needs full results.
   */
  stream(
    prompt: AnyPrompt,
    opts: ExecutorStreamOptions<TModel>,
  ): Promise<ExecutorStreamHandle<TRawStream>>;

  /** Run multiple agents concurrently and merge results. */
  parallel: ReturnType<typeof createCompositions>["parallel"];
  /** Chain agents sequentially with typed data flow. */
  pipeline: ReturnType<typeof createCompositions>["pipeline"];
  /** Run multiple agents and pick a winner via voting. */
  consensus: ReturnType<typeof createCompositions>["consensus"];
  /** Run a swarm of agents with peer-to-peer routing via tool calls. */
  swarm: ReturnType<typeof createCompositions>["swarm"];
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
    const nativeMessages = (opts as { readonly nativeMessages?: readonly unknown[] }).nativeMessages;
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
      tokenBudget: opts.tokenBudget,
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
    })) as GenerateResult;
  }

  // ── stream() ────────────────────────────────────────────────

  async function streamFn(
    prompt: AnyPrompt,
    opts: ExecutorStreamOptions<TModel>,
  ): Promise<ExecutorStreamHandle<TRawStream>> {
    const deadline = Deadline.after(opts.timeout?.totalMs);
    const runWithModel = (
      model: TModel,
      attemptOptions: AttemptSignalOptions = {},
    ): Promise<ExecutorStreamHandle<TRawStream>> =>
      streamSingle(
        prompt,
        opts,
        model,
        deadline.compose(attemptOptions.signal),
        attemptOptions.params,
      );

    try {
      return await resolveModel<TModel, ExecutorStreamHandle<TRawStream>>(
        opts.model as TModel,
        opts.input ?? {},
        runWithModel,
        modelLabel,
        {
          deadline,
          mode: "stream",
          firstTokenMs: opts.timeout?.firstToken,
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
  ): Promise<ExecutorStreamHandle<TRawStream>> {
    const nativeMessages = (opts as { readonly nativeMessages?: readonly unknown[] }).nativeMessages;
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
      tokenBudget: opts.tokenBudget,
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
    })) as ExecutorStreamHandle<TRawStream>;
  }

  // ── Agent executor + compositions ───────────────────────────

  const agentExecutor: AgentExecutor = async (agent, options) => {
    const model = (agent.model ?? options.model) as TModel;
    const start = Date.now();

    const mergedTools = { ...(agent.tools ?? {}), ...(options.tools ?? {}) };
    const generateOpts = {
      model,
      input: options.input as Record<string, unknown>,
      routing: agentRoutingContext(agent, getExecutionContext()),
      maxSteps: options.maxSteps,
      validationRetry: options.validationRetry,
      ...(Object.keys(mergedTools).length > 0 ? { tools: mergedTools } : {}),
    } as unknown as ExecutorGenerateOptions<TModel>;

    const result = await generate(agent.prompt, generateOpts);

    return {
      agentId: agent.id,
      output: result.object ?? result.text,
      durationMs: Date.now() - start,
      usage: result._meta.usage,
    };
  };

  const compositions = createCompositions(agentExecutor);

  return Object.freeze({
    executorId: port.id,
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
