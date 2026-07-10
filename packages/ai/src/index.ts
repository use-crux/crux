/**
 * `@use-crux/ai` — Vercel AI SDK adapter.
 *
 * Provides `generate()` and `stream()` functions that execute Crux prompts
 * through the Vercel AI SDK (`ai` package), built on two boundaries:
 *
 * - **`aiSdkProviderRuntime`** (`@use-crux/core/adapter`) — core owns all
 *   policy: prompt resolution, `fallback()`/`router()`/`cascade()` routing,
 *   validation retry, constraints, guardrails, tool approvals,
 *   instrumentation, timeouts, and observability.
 * - **`SdkGateway`** (this package) — the only seam that calls AI SDK
 *   functions. Inject your own via {@link createCruxAi} to test against a
 *   scripted gateway with zero module mocks.
 *
 * Also exports `@use-crux/ai/stream` for piping Crux plan/task updates
 * through AI SDK UIMessageStreams.
 *
 * @example
 * ```ts
 * import { prompt } from '@use-crux/core'
 * import { generate } from '@use-crux/ai'
 *
 * const result = await generate(myPrompt, {
 *   model: openai('gpt-4o'),
 *   input: { instruction: 'Fix typos' },
 * })
 * ```
 *
 * @module
 */

import type {
  LanguageModel,
  ToolSet,
  GenerateObjectResult,
  GenerateTextResult,
  StreamTextResult,
  StreamObjectResult,
  DeepPartial,
} from "ai";
import type { z } from "zod";
import type {
  Prompt,
  AnyPrompt,
  AnyToolSet,
  Context,
  MergedInput,
  GenerationSettings,
  Message,
  TimeoutOptions,
} from "@use-crux/core";
import type {
  Constraint,
  Guardrail,
  SafetyTuneOptions,
} from "@use-crux/core/safety";
import { isValidationExhaustedError } from "@use-crux/core";
import type { DenseEmbedding } from "@use-crux/core/embedding";
import type { Reranker, RetrievalModel } from "@use-crux/core/retrieval";
import type {
  ApprovalRequestInfo,
  CallHandle,
  ExecutorGenerateOptions,
  ExecutorModelArg,
  ExecutorStreamOptions,
  GenerateResult,
  StreamResult,
} from "@use-crux/core/adapter";
import {
  CruxTransportStreamUnsupportedError,
} from "@use-crux/core/adapter";
import type { ToolApprovalMap, ToolMiddleware } from "@use-crux/core";
import { resolveModel } from "@use-crux/core/routing";
import type {
  AnyRouterModel,
  BoundOk,
  CascadeModel,
  InputOk,
  PromptInputOf,
  StreamOf,
} from "@use-crux/core/routing";
import type {
  GenerateObjectFn,
  GenerateTextFn,
} from "@use-crux/core/compaction";
import type { ValidationRetryOptions } from "@use-crux/core";
import type { SdkGateway } from "./gateway";
import { liveSdkGateway } from "./gateway";
import type { AIExtra, AIGenerateOptions, AIMessageHistory, AITransport } from "./options";
import type { SdkLoopResultLike } from "./executor";
import type {
  AIEmbeddingConfig,
  AIRerankerConfig,
  AIRetrievalModelConfig,
} from "./extensions";
import { aiSdkProviderRuntime } from "./profile";
import { extractModelInfo } from "./provider-profile";
import { createAiStreamResult } from "./stream-result";
import { createStructuredGenerateObjectFn } from "./structured-generation";
import {
  aiSdkHandleFor,
  createManualAiSdkGatewayController,
  transportGateway,
} from "./call-handle";
import { prepareAiSdkMessages } from "./native-messages";
export { fromResponse, toParams } from "./codec";
export type { AiSdkCodecOptions } from "./codec";

// ─────────────────────────────────────────────────────────────────
// Options Types
// ─────────────────────────────────────────────────────────────────

export type { AIExtra, AIGenerateOptions, AITransport, AITransportInfo } from "./options";

// ─────────────────────────────────────────────────────────────────
// Result Types
// ─────────────────────────────────────────────────────────────────

/** Stream result for text prompts. */
export type TextStreamResult<TTools extends ToolSet = Record<string, never>> =
  StreamTextResult<TTools, never>;

/** Stream result for structured prompts. */
export type ObjectStreamResult<T> = StreamObjectResult<
  DeepPartial<T>,
  T,
  never
>;

/** Raw AI SDK result for `generate()` — discriminates on the prompt's output schema. */
export type GenerateReturn<TOutput extends z.ZodType | undefined> =
  TOutput extends z.ZodType<infer O>
    ? GenerateResult<GenerateObjectResult<O> | undefined, O>
    : GenerateResult<GenerateTextResult<Record<string, never>, never> | undefined>;

/** Return type for `stream()` — discriminates on the prompt's output schema. */
export type StreamReturn<TOutput extends z.ZodType | undefined> =
  TOutput extends z.ZodType<infer O>
    ? StreamResult<ObjectStreamResult<O>, O>
    : StreamResult<TextStreamResult>;

// ─────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────

/** Machine-readable failure categories for AI SDK adapter errors. */
export type CruxAIErrorCode =
  | "timeout"
  | "validation_exhausted"
  | "provider"
  | "aborted";

/**
 * Coded error wrapper for `@use-crux/ai` failures.
 *
 * `generate()`/`stream()` propagate underlying errors unchanged (so
 * existing `instanceof ValidationExhaustedError` and `AggregateError`
 * handling keeps working); use {@link CruxAIError.classify} at your
 * boundary when you want a stable, machine-readable code instead of
 * provider-specific error taxonomy.
 *
 * @example
 * ```ts
 * try {
 *   await generate(myPrompt, { model, input })
 * } catch (error) {
 *   const coded = CruxAIError.classify(error)
 *   if (coded.code === 'timeout') return retryLater()
 *   throw coded
 * }
 * ```
 */
export class CruxAIError extends Error {
  override readonly name = "CruxAIError" as const;

  /** Stable failure category — switch on this, not on message text. */
  readonly code: CruxAIErrorCode;

  constructor(
    code: CruxAIErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.code = code;
  }

  /**
   * Classify any thrown error into a `CruxAIError`, preserving the
   * original as `cause`. Crux timeouts map from `TimeoutError`, provider
   * aborts map from `AbortError`, exhausted validation retries from
   * `ValidationExhaustedError`;
   * everything else is `'provider'`.
   */
  static classify(error: unknown): CruxAIError {
    if (error instanceof CruxAIError) return error;
    const message = error instanceof Error ? error.message : String(error);
    if (isValidationExhaustedError(error)) {
      return new CruxAIError("validation_exhausted", message, { cause: error });
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return new CruxAIError("timeout", message, { cause: error });
    }
    if (error instanceof Error && error.name === "AbortError") {
      const code: CruxAIErrorCode = /tim(ed)? ?out/i.test(message)
        ? "timeout"
        : "aborted";
      return new CruxAIError(code, message, { cause: error });
    }
    return new CruxAIError("provider", message, { cause: error });
  }
}

// ─────────────────────────────────────────────────────────────────
// createCruxAi
// ─────────────────────────────────────────────────────────────────

/** Options for {@link createCruxAi}. */
export interface CruxAiOptions {
  /**
   * The AI SDK gateway to execute against.
   * @defaultValue {@link liveSdkGateway} — the real `ai` package functions.
   */
  gateway?: SdkGateway;
}

/** The bound API surface returned by {@link createCruxAi}. */
export interface CruxAi {
  /** See the package-level {@link generate}. */
  generate<
    TOwnInput extends z.ZodType,
    TOutput extends z.ZodType | undefined,
    TContexts extends readonly Context<z.ZodType>[],
    TPromptTools extends AnyToolSet | undefined = undefined,
    TCallTools extends ToolSet | undefined = undefined,
    TRuntimeContext = unknown,
    TModel = CallOpts["model"],
  >(
    prompt: PromptForModel<
      AiPromptInstance<TOwnInput, TOutput, TContexts, TPromptTools>,
      TModel
    >,
    opts: AIGenerateOptions<
      TOwnInput,
      TContexts,
      TCallTools,
      Prompt<TOwnInput, TOutput, TContexts, TPromptTools>,
      TRuntimeContext,
      TModel
    >,
  ): Promise<GenerateReturn<TOutput>>;
  /** See the package-level {@link stream}. */
  stream<
    TOwnInput extends z.ZodType,
    TOutput extends z.ZodType | undefined,
    TContexts extends readonly Context<z.ZodType>[],
    TPromptTools extends AnyToolSet | undefined = undefined,
    TCallTools extends ToolSet | undefined = undefined,
    TRuntimeContext = unknown,
    TModel = CallOpts["model"],
  >(
    prompt: StreamPromptForModel<
      AiPromptInstance<TOwnInput, TOutput, TContexts, TPromptTools>,
      TModel
    >,
    opts: AIGenerateOptions<
      TOwnInput,
      TContexts,
      TCallTools,
      Prompt<TOwnInput, TOutput, TContexts, TPromptTools>,
      TRuntimeContext,
      TModel
    >,
  ): Promise<StreamReturn<TOutput>>;
  /** Prepare a sans-I/O AI SDK call handle for one `generateText()` or `generateObject()` request. */
  prepare?<
    TOwnInput extends z.ZodType,
    TOutput extends z.ZodType | undefined,
    TContexts extends readonly Context<z.ZodType>[],
    TPromptTools extends AnyToolSet | undefined = undefined,
    TCallTools extends ToolSet | undefined = undefined,
    TRuntimeContext = unknown,
    TModel = CallOpts["model"],
  >(
    prompt: PromptForModel<
      AiPromptInstance<TOwnInput, TOutput, TContexts, TPromptTools>,
      TModel
    >,
    opts: AIGenerateOptions<
      TOwnInput,
      TContexts,
      TCallTools,
      Prompt<TOwnInput, TOutput, TContexts, TPromptTools>,
      TRuntimeContext,
      TModel
    >,
  ): Promise<CallHandle<Record<string, unknown>, SdkLoopResultLike, GenerateReturn<TOutput>>>;
  /** See the package-level {@link generateTextFn}. */
  generateTextFn: GenerateTextFn;
  /** See the package-level {@link generateObjectFn}. */
  generateObjectFn: GenerateObjectFn;
  /** See the package-level {@link embedding}. */
  embedding(config: AIEmbeddingConfig): DenseEmbedding;
  /** See the package-level {@link retrievalModel}. */
  retrievalModel(config: AIRetrievalModelConfig): RetrievalModel;
  /** See the package-level {@link reranker}. */
  reranker(config: AIRerankerConfig): Reranker;
}

/** Internal: the loosely-typed view of call opts used by the implementation. */
type CallOpts = Record<string, unknown> & {
  model: ExecutorModelArg<LanguageModel>;
  routing?: unknown;
  route?: string;
  tools?: ToolSet;
  toolsContext?: Readonly<Record<string, unknown>>;
  runtimeContext?: unknown;
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[];
  toolApproval?: ToolApprovalMap;
  messages?: AIMessageHistory;
  maxSteps?: number;
  extra?: AIExtra;
  activeTools?: readonly string[];
  tokenBudget?: number;
  timeout?: TimeoutOptions;
  validationRetry?: ValidationRetryOptions;
  constraints?: Constraint[];
  constraintMaxRetries?: number;
  guardrails?: Guardrail[];
  safety?: SafetyTuneOptions;
  input?: Record<string, unknown>;
  transport?: AITransport;
};

type AiPromptInstance<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly Context<z.ZodType>[],
  TPromptTools extends AnyToolSet | undefined,
> = Prompt<TOwnInput, TOutput, TContexts, TPromptTools>;

type PromptForModel<P extends AnyPrompt, M> = P &
  BoundOk<M, P> &
  InputOk<M, PromptInputOf<P>>;

type StreamPromptForModel<P extends AnyPrompt, M> = PromptForModel<P, M> &
  (StreamOf<M> extends true
    ? unknown
    : ["model contains a cascade; cascades are generate-only"]);

/**
 * Build a `@use-crux/ai` instance bound to a specific {@link SdkGateway}.
 *
 * The package-level `generate`/`stream`/`embedding` exports are an
 * instance created with the live gateway — most applications never call
 * this. Reach for it when you need the test seam:
 *
 * @example
 * ```ts
 * import { createCruxAi } from '@use-crux/ai'
 *
 * const scripted = scriptedGateway({ generateText: [{ text: 'scripted!' }] })
 * const ai = createCruxAi({ gateway: scripted })
 * const result = await ai.generate(myPrompt, { model, input })
 * expect(result.text).toBe('scripted!')
 * ```
 */
export function createCruxAi(options: CruxAiOptions = {}): CruxAi {
  const gateway = options.gateway ?? liveSdkGateway();
  const executor = aiSdkProviderRuntime.create(gateway);

  async function runGenerate(
    activeExecutor: typeof executor,
    prompt: AnyPrompt,
    opts: CallOpts,
  ): Promise<GenerateResult<SdkLoopResultLike | undefined>> {
    const {
      model,
      tools,
      toolsContext,
      runtimeContext,
      toolMiddleware,
      toolApproval,
      messages,
      maxSteps,
      extra,
      activeTools,
      tokenBudget,
      timeout,
      routing,
      route,
      validationRetry,
      constraints,
      constraintMaxRetries,
      guardrails,
      safety,
      input,
      transport: _transport,
      ...settings
    } = opts;

    const messagePlan = prepareAiSdkMessages(messages);
    const executorOptions = {
      model,
      input,
      routing,
      route,
      tools: tools as Record<string, unknown> | undefined,
      toolsContext,
      runtimeContext,
      toolMiddleware,
      toolApproval,
      messages: messagePlan.messages,
      nativeMessages: messagePlan.nativeMessages,
      tokenBudget,
      timeout,
      validationRetry,
      constraints,
      constraintMaxRetries,
      guardrails,
      safety,
      activeTools,
      // The Crux-wide default budget (10, from loopRuntimeAdapter) — identical
      // across every adapter, enforced natively via the AI SDK's stopWhen.
      maxSteps,
      settings: settings as GenerationSettings,
      extra,
    } as ExecutorGenerateOptions<LanguageModel>;

    const result = await activeExecutor.generate(prompt, executorOptions);

    return result as GenerateResult<SdkLoopResultLike | undefined>;
  }

  async function generateImpl(
    prompt: AnyPrompt,
    opts: CallOpts,
  ): Promise<GenerateResult<SdkLoopResultLike | undefined>> {
    if (opts.transport) {
      return runGenerate(aiSdkProviderRuntime.create(transportGateway(opts.transport)), prompt, opts);
    }
    return runGenerate(executor, prompt, opts);
  }

  async function prepareImpl(
    prompt: AnyPrompt,
    opts: CallOpts,
  ): Promise<CallHandle<Record<string, unknown>, SdkLoopResultLike, GenerateResult<SdkLoopResultLike | undefined>>> {
    const controller = createManualAiSdkGatewayController();
    const manualExecutor = aiSdkProviderRuntime.create({
      generateText: (args) => controller.generateText(args),
      generateObject: (args) => controller.generateObject(args),
      streamText: () => {
        throw new TypeError("AI SDK call handles do not support streamText().");
      },
      streamObject: () => {
        throw new TypeError("AI SDK call handles do not support streamObject().");
      },
      embedMany: gateway.embedMany,
      rerank: gateway.rerank,
    });

    void runGenerate(manualExecutor, prompt, opts)
      .then((result) => controller.complete(result))
      .catch((error) => controller.fail(error));

    return aiSdkHandleFor(await controller.first(), controller);
  }

  async function streamImpl(
    prompt: AnyPrompt,
    opts: CallOpts,
  ): Promise<Record<string, unknown>> {
    const {
      model,
      tools,
      toolsContext,
      runtimeContext,
      toolMiddleware,
      toolApproval,
      messages,
      maxSteps,
      extra,
      activeTools,
      tokenBudget,
      timeout,
      routing,
      route,
      validationRetry: _validationRetry,
      constraints,
      constraintMaxRetries,
      guardrails,
      safety,
      input,
      transport,
      ...settings
    } = opts;

    if (transport) throw new CruxTransportStreamUnsupportedError("ai-sdk");

    const messagePlan = prepareAiSdkMessages(messages);
    const executorOptions = {
      model,
      input,
      routing,
      route,
      tools: tools as Record<string, unknown> | undefined,
      toolsContext,
      runtimeContext,
      toolMiddleware,
      toolApproval,
      messages: messagePlan.messages,
      nativeMessages: messagePlan.nativeMessages,
      tokenBudget,
      timeout,
      constraints,
      constraintMaxRetries,
      guardrails,
      safety,
      activeTools,
      maxSteps,
      settings: settings as GenerationSettings,
      extra,
    } as ExecutorStreamOptions<LanguageModel>;

    const handle = await executor.stream(prompt, executorOptions);

    return createAiStreamResult(handle) as unknown as Record<string, unknown>;
  }

  const generateFn = generateImpl as unknown as CruxAi["generate"];
  const streamFn = streamImpl as unknown as CruxAi["stream"];
  const prepareFn = prepareImpl as unknown as NonNullable<CruxAi["prepare"]>;

  const generateObjectFnImpl: GenerateObjectFn =
    createStructuredGenerateObjectFn(gateway);

  const generateTextFnImpl: GenerateTextFn = async (options) => {
    const run = async (model: LanguageModel, attemptOptions: { readonly signal?: AbortSignal } = {}) => {
      const result = await gateway.generateText({
        model,
        system: options.system,
        prompt: options.prompt,
        ...(attemptOptions.signal ? { abortSignal: attemptOptions.signal } : {}),
      } as Parameters<SdkGateway["generateText"]>[0]);
      return { text: result.text };
    };
    return resolveModel<LanguageModel, { text: string }>(
      options.model as LanguageModel,
      { prompt: options.prompt },
      run,
      (model) => {
        const info = extractModelInfo(model);
        return info.modelId || info.provider;
      },
      { mode: "generate", preserveRawResult: true },
    );
  };

  return {
    generate: generateFn,
    stream: streamFn,
    prepare: prepareFn,
    generateTextFn: generateTextFnImpl,
    generateObjectFn: generateObjectFnImpl,
    embedding: executor.embedding,
    retrievalModel: executor.retrievalModel,
    reranker: executor.reranker,
  };
}

// ─────────────────────────────────────────────────────────────────
// Default instance (live gateway) — the package-level API
// ─────────────────────────────────────────────────────────────────

const defaultAi = createCruxAi();

/**
 * Execute a prompt using the Vercel AI SDK.
 *
 * - With an `output` schema: returns a typed `GenerateObjectResult` —
 *   `result.object` is validated against the prompt's schema, with
 *   tiered repair/retry when `validationRetry` is configured.
 * - Without: returns a `GenerateTextResult`; multi-step tool use is
 *   bounded by `maxSteps` and portable `stopWhen` settings.
 *
 * Models may be plain AI SDK models or core routing wrappers —
 * `fallback()`, `router()`, and `cascade()` are resolved by core before
 * any provider call, with attempt metadata in `result._meta`.
 *
 * @example
 * ```ts
 * import { generate } from '@use-crux/ai'
 *
 * // Structured output with validation retry
 * const result = await generate(editPrompt, {
 *   model: openrouter('anthropic/claude-sonnet-4-5'),
 *   input: { instruction },
 *   validationRetry: { maxRetries: 2 },
 *   timeout: { totalMs: 60_000 },
 * })
 * result.object // typed from the prompt's output schema
 * ```
 */
export const generate = defaultAi.generate;

/**
 * Stream a prompt using the Vercel AI SDK.
 *
 * Returns the SDK's own stream result (`textStream`, `fullStream`,
 * `partialObjectStream`, …) extended with a typed `completion` promise
 * resolving to usage, cost, and timing metrics when the stream finishes.
 *
 * `cascade()` models are rejected — tier evaluation needs full results;
 * use `generate()` for cascades.
 *
 * @example
 * ```ts
 * import { stream } from '@use-crux/ai'
 *
 * const result = await stream(chatPrompt, { model, input: { message } })
 * for await (const delta of result.textStream) process.stdout.write(delta)
 * const meta = await result.completion // { usage, cost, streaming: { ttftMs, … } }
 * ```
 */
export const stream = defaultAi.stream;

/** Prepare a sans-I/O AI SDK call handle. */
export const prepare = defaultAi.prepare!;

/**
 * AI SDK `generateText` wrapped as a `GenerateTextFn`.
 *
 * Use this when calling `@use-crux/core` APIs that expect a `GenerateTextFn`
 * (e.g., `compactConversation()`, `summarizeMessages()`).
 *
 * @example
 * ```ts
 * import { generateTextFn } from '@use-crux/ai'
 * import { compactConversation } from '@use-crux/convex'
 *
 * await compactConversation({ generate: generateTextFn, model, ... })
 * ```
 */
export const generateTextFn = defaultAi.generateTextFn;

/**
 * AI SDK `generateObject` wrapped as a `GenerateObjectFn`.
 *
 * Use this when calling `@use-crux/core` APIs that expect a `GenerateObjectFn`
 * (e.g., `judge().score()`, `extractKeyFacts()`).
 *
 * This helper shares the same AI SDK structured-attempt mechanics used by
 * prompt structured generation: provider schema sanitation, core-backed JSON
 * repair, and router/cascade model resolution. It still exposes only the
 * lightweight `GenerateObjectFn` result shape. Use
 * `createGenerateObjectFnFromGenerate(generate)` from `@use-crux/core/compaction`
 * when the helper call must also run through full adapter prompt execution.
 *
 * @example
 * ```ts
 * import { generateObjectFn } from '@use-crux/ai'
 * import { judge } from '@use-crux/core/scoring'
 *
 * const evaluator = judge({ ... })
 * const result = await evaluator.score(input, { generate: generateObjectFn, model })
 * ```
 */
export const generateObjectFn = defaultAi.generateObjectFn;

/**
 * Create a dense Crux embedding backed by AI SDK `embedMany()`.
 *
 * Use this when you want retrieval/indexing to share the same provider
 * registry and model objects that power `generate()` / `stream()`.
 */
export function embedding(config: AIEmbeddingConfig): DenseEmbedding {
  return defaultAi.embedding(config);
}

/**
 * Create a bound retrieval model backed by AI SDK `generateText()` and `generateObject()`.
 */
export function retrievalModel(config: AIRetrievalModelConfig): RetrievalModel {
  return defaultAi.retrievalModel(config);
}

/**
 * Create a Crux retriever reranker backed by AI SDK `rerank()`.
 */
export function reranker(config: AIRerankerConfig): Reranker {
  return defaultAi.reranker(config);
}

// ─────────────────────────────────────────────────────────────────
// Gateway exports (test seam)
// ─────────────────────────────────────────────────────────────────

export { liveSdkGateway } from "./gateway";
export type { SdkGateway } from "./gateway";
export { createAiSdkLoopRuntime } from "./executor";
export type {
  AiSdkLoopRuntime,
  SdkLoopResultLike,
  SdkStreamResultLike,
} from "./executor";
export type {
  AIEmbeddingConfig,
  AIRerankerConfig,
  AIRetrievalModelConfig,
  AiSdkRuntimeExtensions,
} from "./extensions";
export { aiSdkProviderRuntime } from "./profile";
export {
  createUIMessageStreamResponse,
  pipeUIMessageStreamToResponse,
} from "./ui-message";
export type {
  CruxPipeUIMessageStreamOptions,
  CruxUIMessageStreamResponseOptions,
} from "./ui-message";

// ─────────────────────────────────────────────────────────────────
// What is intentionally NOT exported from the root
// ─────────────────────────────────────────────────────────────────
//
// - AI SDK re-exports (`tool`, provider-native stop helpers, types):
//   import them from 'ai' directly — `@use-crux/ai` is an adapter, not a
//   re-packaging of the SDK.
// - Agent compositions (`parallel`, `pipeline`, `consensus`, `swarm`):
//   construct them from `aiSdkProviderRuntime.create(liveSdkGateway())`
//   or use `@use-crux/core/agent` — composition is core policy.
// - Legacy AI adapter codec helpers and `createAIExecutor`: dead surface from
//   the old adapter shape (RFC use-crux/crux#28). Message normalization
//   remains an internal adapter boundary, not a root export.
