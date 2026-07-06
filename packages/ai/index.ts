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
  ToolChoice as AiToolChoice,
  StopCondition as AiStopCondition,
  CallSettings,
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
  Context,
  ResolvedPrompt,
  MergedInput,
  GenerationSettings,
  Message,
} from "@use-crux/core";
import type { Constraint, Guardrail } from "@use-crux/core/safety";
import { isValidationExhaustedError } from "@use-crux/core";
import type { DenseEmbedding } from "@use-crux/core/embedding";
import type { Reranker, RetrievalModel } from "@use-crux/core/retrieval";
import type {
  ApprovalRequestInfo,
  ExecutorModelArg,
  ExecutorStreamMeta,
} from "@use-crux/core/adapter";
import type { ToolMiddleware, FallbackModel } from "@use-crux/core";
import { isRouter, isCascade, resolveModel } from "@use-crux/core/routing";
import type { AnyRouterModel, CascadeModel } from "@use-crux/core/routing";
import type {
  GenerateObjectFn,
  GenerateTextFn,
} from "@use-crux/core/compaction";
import type { ValidationRetryOptions } from "@use-crux/core";
import type { SdkGateway } from "./src/gateway";
import { liveSdkGateway } from "./src/gateway";
import type { SdkLoopResultLike } from "./src/executor";
import type {
  AIEmbeddingConfig,
  AIRerankerConfig,
  AIRetrievalModelConfig,
} from "./src/extensions";
import { aiSdkProviderRuntime } from "./src/profile";
import { extractModelInfo } from "./src/provider-profile";
import { createStructuredGenerateObjectFn } from "./src/structured-generation";

type AiProviderOptions = Parameters<
  SdkGateway["generateText"]
>[0]["providerOptions"];

// ─────────────────────────────────────────────────────────────────
// Options Types
// ─────────────────────────────────────────────────────────────────

/** AI SDK-native, non-portable options for `generate()` and `stream()`. */
export interface AIExtra extends Record<string, unknown> {
  /** AI SDK-native tool choice strategy. Prefer Crux `toolChoice` for portable calls. */
  readonly toolChoice?: AiToolChoice<ToolSet>;
  /** AI SDK-native stop conditions. Prefer Crux `stopWhen` for portable calls. */
  readonly stopWhen?:
    | AiStopCondition<ToolSet>
    | Array<AiStopCondition<ToolSet>>;
}

/** Options for `generate()` and `stream()` with AI SDK models. */
export type AIGenerateOptions<
  TOwnInput extends z.ZodType,
  TContexts extends readonly Context<z.ZodType>[],
> = {
  /** The AI SDK language model to use. Supports `fallback()`, `router()`, and `cascade()` wrappers. */
  model:
    | LanguageModel
    | FallbackModel<LanguageModel>
    | AnyRouterModel<LanguageModel>
    | CascadeModel<LanguageModel>;
  /** Additional tools to merge at call time (highest precedence). */
  tools?: ToolSet;
  /** Tool middleware applied after prompt tools and call-site tools are merged. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[];
  /**
   * Message history override for resume flows such as tool approval.
   * Pass the prior assistant messages plus a `tool-approval-response` tool message.
   */
  messages?: ResolvedPrompt["messages"];
  /**
   * Maximum tool-loop steps, identical to every Crux adapter.
   *
   * Portable `settings.maxSteps`/`maxSteps()` are normalized to the same
   * neutral stop-condition vocabulary before reaching the AI SDK.
   * @default 10
   */
  maxSteps?: number;
  /** AI SDK-native, non-portable options. */
  extra?: AIExtra;
  /** AI SDK provider-specific options passed through to the underlying call. */
  providerOptions?: AiProviderOptions;
  /** Restrict which tools the model can use. */
  activeTools?: string[];
  /** Token budget for system message. */
  tokenBudget?: number;
  /**
   * Optional hard timeout for the provider call in milliseconds.
   * Crux passes an AbortSignal to the AI SDK and rejects with AbortError
   * if the provider does not settle before the deadline.
   */
  timeoutMs?: number;
  /**
   * Validation-feedback retry for structured output.
   * Uses AI SDK's `experimental_repairText` for cheap text fixes first,
   * then falls back to LLM retry with corrective messages.
   */
  validationRetry?: ValidationRetryOptions;
  /** Per-call semantic constraints (highest precedence in the safety merge). */
  constraints?: Constraint[];
  /** Shared cap on total constraint retries across all constraints. */
  constraintMaxRetries?: number;
  /** Per-call guardrails (highest precedence in the safety merge). */
  guardrails?: Guardrail[];
} & Omit<CallSettings, "toolChoice" | "stopWhen"> &
  GenerationSettings &
  ([keyof MergedInput<TOwnInput, TContexts>] extends [never]
    ? { input?: undefined }
    : { input: MergedInput<TOwnInput, TContexts> });

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

/** Return type for `generate()` — discriminates on the prompt's output schema. */
export type GenerateReturn<TOutput extends z.ZodType | undefined> =
  TOutput extends z.ZodType<infer O>
    ? GenerateObjectResult<O>
    : GenerateTextResult<Record<string, never>, never>;

/** Return type for `stream()` — discriminates on the prompt's output schema. */
export type StreamReturn<TOutput extends z.ZodType | undefined> =
  TOutput extends z.ZodType<infer O> ? ObjectStreamResult<O> : TextStreamResult;

/**
 * Extra fields `@use-crux/ai` attaches to every stream result alongside the
 * AI SDK's own surface.
 */
export interface CruxStreamExtensions {
  /**
   * Resolves when the stream finishes, with usage, cost, finish reason,
   * and timing metrics (TTFT, tokens/sec, chunk count). Safe to await
   * before, during, or after consuming the stream — it never consumes
   * the stream itself.
   */
  completion: Promise<ExecutorStreamMeta | undefined>;
}

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
   * original as `cause`. Timeouts and aborts map from `AbortError`s,
   * exhausted validation retries from `ValidationExhaustedError`;
   * everything else is `'provider'`.
   */
  static classify(error: unknown): CruxAIError {
    if (error instanceof CruxAIError) return error;
    const message = error instanceof Error ? error.message : String(error);
    if (isValidationExhaustedError(error)) {
      return new CruxAIError("validation_exhausted", message, { cause: error });
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
  >(
    prompt: Prompt<TOwnInput, TOutput, TContexts>,
    opts: AIGenerateOptions<TOwnInput, TContexts>,
  ): Promise<GenerateReturn<TOutput>>;
  /** See the package-level {@link stream}. */
  stream<
    TOwnInput extends z.ZodType,
    TOutput extends z.ZodType | undefined,
    TContexts extends readonly Context<z.ZodType>[],
  >(
    prompt: Prompt<TOwnInput, TOutput, TContexts>,
    opts: AIGenerateOptions<TOwnInput, TContexts>,
  ): Promise<StreamReturn<TOutput> & CruxStreamExtensions>;
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
  tools?: ToolSet;
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[];
  messages?: ResolvedPrompt["messages"];
  maxSteps?: number;
  extra?: AIExtra;
  providerOptions?: AiProviderOptions;
  activeTools?: string[];
  tokenBudget?: number;
  timeoutMs?: number;
  validationRetry?: ValidationRetryOptions;
  constraints?: Constraint[];
  constraintMaxRetries?: number;
  guardrails?: Guardrail[];
  input?: Record<string, unknown>;
};

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

  async function generateImpl(
    prompt: AnyPrompt,
    opts: CallOpts,
  ): Promise<SdkLoopResultLike> {
    const {
      model,
      tools,
      toolMiddleware,
      messages,
      maxSteps,
      extra,
      activeTools,
      tokenBudget,
      timeoutMs,
      validationRetry,
      constraints,
      constraintMaxRetries,
      guardrails,
      input,
      ...settings
    } = opts;

    const result = await executor.generate(prompt, {
      model,
      input,
      tools: tools as Record<string, unknown> | undefined,
      toolMiddleware,
      messages: messages as Message[] | undefined,
      tokenBudget,
      timeoutMs,
      validationRetry,
      constraints,
      constraintMaxRetries,
      guardrails,
      activeTools,
      // The Crux-wide default budget (10, from loopRuntimeAdapter) — identical
      // across every adapter, enforced natively via the AI SDK's stopWhen.
      maxSteps,
      settings: settings as GenerationSettings,
      extra,
    });

    if (result.raw) {
      const raw = result.raw as SdkLoopResultLike;
      raw._meta = { ...(result._meta as Record<string, unknown>) };
      return raw;
    }

    // No SDK result object exists in two cases: suspended on tool approval,
    // or a cassette-replayed outcome (recordings never carry `raw`). Surface
    // a result-shaped object with everything consumers read — including the
    // parsed structured `object`, which Quality's output normalization needs.
    return {
      text: result.text,
      ...(result.object !== undefined ? { object: result.object } : {}),
      _meta: { ...(result._meta as Record<string, unknown>) },
      messages: result.messages,
      pendingApprovals: result.pendingApprovals,
    } as SdkLoopResultLike & {
      messages: Message[];
      pendingApprovals?: readonly ApprovalRequestInfo[];
    };
  }

  async function streamImpl(
    prompt: AnyPrompt,
    opts: CallOpts,
  ): Promise<Record<string, unknown>> {
    const {
      model,
      tools,
      toolMiddleware,
      messages,
      maxSteps,
      extra,
      activeTools,
      tokenBudget,
      timeoutMs,
      validationRetry: _validationRetry,
      constraints,
      constraintMaxRetries,
      guardrails,
      input,
      ...settings
    } = opts;

    const handle = await executor.stream(prompt, {
      model,
      input,
      tools: tools as Record<string, unknown> | undefined,
      toolMiddleware,
      messages: messages as Message[] | undefined,
      tokenBudget,
      timeoutMs,
      constraints,
      constraintMaxRetries,
      guardrails,
      activeTools,
      maxSteps,
      settings: settings as GenerationSettings,
      extra,
    });

    const raw = handle.raw as Record<string, unknown>;
    const completion = handle.completion();
    const existingMeta =
      (raw._meta as Record<string, unknown> | undefined) ?? {};
    // Typed completion plus the legacy `_meta._streamCompletion` location.
    raw._meta = { ...existingMeta, _streamCompletion: completion };
    (
      raw as { completion?: Promise<ExecutorStreamMeta | undefined> }
    ).completion = completion;
    return raw;
  }

  const generateFn = generateImpl as unknown as CruxAi["generate"];
  const streamFn = streamImpl as unknown as CruxAi["stream"];

  const generateObjectFnImpl: GenerateObjectFn =
    createStructuredGenerateObjectFn(gateway);

  const generateTextFnImpl: GenerateTextFn = async (options) => {
    const run = async (model: LanguageModel) => {
      const result = await gateway.generateText({
        model,
        system: options.system,
        prompt: options.prompt,
      } as Parameters<SdkGateway["generateText"]>[0]);
      return { text: result.text };
    };
    if (isRouter(options.model) || isCascade(options.model)) {
      const resolved = await resolveModel<LanguageModel, { text: string }>(
        options.model as unknown as LanguageModel,
        { prompt: options.prompt },
        run,
        (model) => {
          const info = extractModelInfo(model);
          return info.modelId || info.provider;
        },
      );
      return { text: resolved.text };
    }
    return run(options.model as LanguageModel);
  };

  return {
    generate: generateFn,
    stream: streamFn,
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
 *   timeoutMs: 60_000,
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
 * (e.g., `llmJudge().score()`, `extractKeyFacts()`).
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
 * import { llmJudge } from '@use-crux/core/scoring'
 *
 * const judge = llmJudge({ ... })
 * const result = await judge.score(input, { generate: generateObjectFn, model })
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

export { liveSdkGateway } from "./src/gateway";
export type { SdkGateway } from "./src/gateway";
export { createAiSdkLoopRuntime } from "./src/executor";
export type {
  AiSdkLoopRuntime,
  SdkLoopResultLike,
  SdkStreamResultLike,
} from "./src/executor";
export type {
  AIEmbeddingConfig,
  AIRerankerConfig,
  AIRetrievalModelConfig,
  AiSdkRuntimeExtensions,
} from "./src/extensions";
export { aiSdkProviderRuntime } from "./src/profile";

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
// - `toMessages`/`fromMessages`/`createAIExecutor`: dead surface from the
//   legacy AI adapter shape (RFC use-crux/crux#28).
