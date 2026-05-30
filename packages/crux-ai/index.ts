/**
 * `@crux/ai` — Vercel AI SDK adapter.
 *
 * Provides `generate()` and `stream()` functions that execute prompts
 * using the Vercel AI SDK (`ai` package).
 *
 * Also exports `@crux/ai/stream` for piping Crux plan/task updates
 * through AI SDK UIMessageStreams. See {@link createCruxStreamWriter}
 * (server) and {@link createStreamTransport} (client).
 *
 * @example
 * ```ts
 * import { prompt } from '@crux/core'
 * import { generate, stream, tool } from '@crux/ai'
 *
 * const result = await generate(myPrompt, {
 *   model: openai('gpt-4o'),
 *   input: { instruction: 'Fix typos' },
 * })
 * ```
 *
 * @module
 */

import {
  embedMany as aiEmbedMany,
  generateObject,
  generateText,
  streamObject,
  streamText,
  rerank as aiRerank,
  jsonSchema as wrapJsonSchema,
} from 'ai'
import type {
  EmbeddingModel,
  LanguageModel,
  RerankingModel,
  ToolSet,
  ToolChoice,
  StopCondition,
  CallSettings,
  GenerateObjectResult,
  GenerateTextResult,
  StreamTextResult,
  StreamObjectResult,
  DeepPartial,
} from 'ai'
import type { z } from 'zod'
import type {
  Prompt,
  AnyPrompt,
  Context,
  ResolvedPrompt,
  MergedInput,
  GenerateHookArgs,
  ErrorHookArgs,
  ModelInfo,
  JsonValue,
  ToolModelOutput,
} from '@crux/core'
import type { DenseEmbedding } from '@crux/core/embedding'
import { embedding as coreEmbedding } from '@crux/core/embedding'
import type { RetrieverHit, RetrieverReranker } from '@crux/core/retrieval'
import { reranker as coreReranker } from '@crux/core/retrieval'
import {
  getRuntime,
  isFallback,
  executeFallbackLoop,
  orchestrateGenerate,
  orchestrateStream,
  sanitizeJsonSchema,
  applyToolMiddleware,
  notifyToolApprovalResponses,
} from '@crux/core'
import { observe } from '@crux/core/observability'
import type { ToolMiddleware } from '@crux/core'
import { isRouter, isCascade, resolveModel } from '@crux/core/routing'
import type { AnyRouterModel, CascadeModel } from '@crux/core/routing'
import type { FallbackModel } from '@crux/core'
import type { Message } from '@crux/core'
import type { GenerateObjectFn, GenerateTextFn } from '@crux/core/compaction'
import { repairJsonText, ValidationExhaustedError } from '@crux/core'
import type { ValidationRetryOptions } from '@crux/core'

// ─────────────────────────────────────────────────────────────────
// Message Converters
// ─────────────────────────────────────────────────────────────────

/**
 * Convert AI SDK `CoreMessage[]` to canonical `Message[]`.
 *
 * Handles AI SDK's content format (string or array of parts) by
 * extracting the text content. Tool call/result metadata is preserved
 * in the `metadata` field.
 */
export function toMessages(
  sdkMessages: Array<{
    role: string
    content: unknown
    [key: string]: unknown
  }>,
): Message[] {
  return sdkMessages.map((msg) => {
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? (msg.content as Array<{ type?: string; text?: string }>)
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('')
          : String(msg.content ?? '')

    const role = normalizeRole(msg.role)
    const metadata: Record<string, unknown> = {}

    if (msg.toolCallId) metadata.toolCallId = msg.toolCallId
    if (msg.toolName) metadata.toolName = msg.toolName
    const providerMeta = (msg as { experimental_providerMetadata?: unknown }).experimental_providerMetadata
    if (providerMeta) {
      metadata.providerMetadata = providerMeta
    }

    // Preserve tool calls from assistant messages
    if (Array.isArray(msg.content)) {
      type ToolCallPart = { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }
      const toolCalls = (msg.content as Array<{ type?: string }>).filter(
        (p): p is ToolCallPart => p.type === 'tool-call',
      )
      if (toolCalls.length > 0) {
        metadata.toolCalls = toolCalls.map((tc) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          args: tc.args,
        }))
      }
    }

    return {
      role,
      content,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    }
  })
}

/**
 * Convert canonical `Message[]` to AI SDK `CoreMessage[]` format.
 */
export function fromMessages(messages: Message[]): Array<{ role: string; content: string; [key: string]: unknown }> {
  return messages.map((msg) => {
    const result: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    }

    if (msg.metadata?.toolCallId) result.toolCallId = msg.metadata.toolCallId
    if (msg.metadata?.toolName) result.toolName = msg.metadata.toolName

    return result as { role: string; content: string; [key: string]: unknown }
  })
}

function normalizeRole(role: string): Message['role'] {
  if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') {
    return role
  }
  return 'user'
}

// ─────────────────────────────────────────────────────────────────
// Model Info Extraction
// ─────────────────────────────────────────────────────────────────

/**
 * Extract provider and model ID from an AI SDK `LanguageModel`.
 *
 * Handles both string IDs (e.g. `"openai:gpt-4o"`) and model objects
 * (which expose `.provider` and `.modelId` properties).
 */
function extractModelInfo(model: LanguageModel): ModelInfo {
  if (typeof model === 'string') {
    const idx = model.indexOf(':')
    if (idx > 0) {
      return { provider: model.slice(0, idx), modelId: model.slice(idx + 1) }
    }
    return { provider: '', modelId: model }
  }
  const m = model as { provider?: unknown; modelId?: unknown }
  return {
    provider: typeof m.provider === 'string' ? m.provider : '',
    modelId: typeof m.modelId === 'string' ? m.modelId : '',
  }
}

// ─────────────────────────────────────────────────────────────────
// Schema Sanitization (Anthropic compatibility)
// ─────────────────────────────────────────────────────────────────

/**
 * Detect whether a model targets Anthropic's API.
 *
 * Handles both direct Anthropic SDK usage (provider = 'anthropic') and
 * OpenRouter-routed Anthropic models (provider = 'openrouter', modelId = 'anthropic/...').
 */
function isAnthropicModel(modelInfo: ModelInfo): boolean {
  return modelInfo.provider.startsWith('anthropic') || modelInfo.modelId.startsWith('anthropic/')
}

/**
 * For Anthropic models: convert Zod schema → JSON Schema, strip
 * unsupported properties (maxItems, minimum, etc.), and wrap in
 * the AI SDK's `jsonSchema()`. Other providers get the Zod schema as-is.
 *
 * Returns `unknown` because the result is either the original Zod schema
 * or the AI SDK's opaque jsonSchema wrapper — both valid `schema` inputs
 * to `generateObject`/`streamObject`.
 */
async function sanitizeSchemaForProvider(schema: z.ZodType, modelInfo: ModelInfo): Promise<unknown> {
  if (!isAnthropicModel(modelInfo)) return schema
  const { z: zod } = await import('zod')
  const raw = zod.toJSONSchema(schema) as Record<string, unknown>
  const sanitized = sanitizeJsonSchema(raw, 'anthropic')
  return wrapJsonSchema(sanitized)
}

// ─────────────────────────────────────────────────────────────────
// Cost Extraction
// ─────────────────────────────────────────────────────────────────

type ProviderCostEntry = { usage?: { cost?: unknown }; cost?: unknown }

/**
 * Extract cost from providerMetadata if the provider returns it.
 *
 * Currently only OpenRouter includes cost in responses
 * (`providerMetadata.openrouter.usage.cost`). This also checks
 * other providers generically in case they add cost support.
 */
function extractCost(providerMetadata: unknown): number | undefined {
  if (!providerMetadata || typeof providerMetadata !== 'object') return undefined
  const meta = providerMetadata as Record<string, ProviderCostEntry | undefined>
  // OpenRouter: providerMetadata.openrouter.usage.cost
  const orCost = meta.openrouter?.usage?.cost
  if (typeof orCost === 'number') return orCost
  // Generic: check any provider that exposes a cost field
  for (const provider of Object.values(meta)) {
    const cost = provider?.usage?.cost ?? provider?.cost
    if (typeof cost === 'number') return cost
  }
  return undefined
}

// ─────────────────────────────────────────────────────────────────
// Options Types
// ─────────────────────────────────────────────────────────────────

/** Options for `generate()` and `stream()` with AI SDK types. */
export type AIGenerateOptions<TOwnInput extends z.ZodType, TContexts extends readonly Context<z.ZodType>[]> = {
  /** The AI SDK language model to use. Supports `fallback()`, `router()`, and `cascade()` wrappers. */
  model: LanguageModel | FallbackModel<LanguageModel> | AnyRouterModel<LanguageModel> | CascadeModel<LanguageModel>
  /** Additional tools to merge at call time (highest precedence). */
  tools?: ToolSet
  /** Tool middleware applied after prompt tools and call-site tools are merged. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[]
  /**
   * Message history override for resume flows such as tool approval.
   * Pass the prior assistant messages plus a `tool-approval-response` tool message.
   */
  messages?: ResolvedPrompt['messages']
  /** Tool choice strategy. */
  toolChoice?: ToolChoice<ToolSet>
  /** Stop condition for multi-step tool use. */
  stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>
  /** Restrict which tools the model can use. */
  activeTools?: string[]
  /** Token budget for system message. */
  tokenBudget?: number
  /**
   * Optional hard timeout for the provider call in milliseconds.
   * Crux passes an AbortSignal to the AI SDK and rejects with AbortError
   * if the provider does not settle before the deadline.
   */
  timeoutMs?: number
  /**
   * Validation-feedback retry for structured output.
   * Uses AI SDK's `experimental_repairText` for cheap text fixes first,
   * then falls back to LLM retry with corrective messages.
   */
  validationRetry?: ValidationRetryOptions
} & CallSettings &
  ([keyof MergedInput<TOwnInput, TContexts>] extends [never]
    ? { input?: undefined }
    : { input: MergedInput<TOwnInput, TContexts> })

export interface AIRerankerConfig {
  name: string
  model: RerankingModel
  topN?: number
  maxRetries?: number
  document?: (hit: RetrieverHit) => string
}

export interface AIEmbeddingConfig {
  name: string
  model: EmbeddingModel
  dimensions: number
  maxInputTokens: number
  batch?: {
    maxSize?: number
    concurrency?: number
  }
  maxRetries?: number
  maxParallelCalls?: number
  headers?: Record<string, string>
  providerOptions?: Record<string, unknown>
}

/**
 * Create a dense Crux embedding backed by AI SDK `embedMany()`.
 *
 * Use this when you want retrieval/indexing to share the same provider registry
 * and model objects that power `generate()` / `stream()`.
 */
export function embedding(config: AIEmbeddingConfig): DenseEmbedding {
  return coreEmbedding({
    kind: 'dense',
    name: config.name,
    dimensions: config.dimensions,
    maxInputTokens: config.maxInputTokens,
    batch: {
      maxSize: config.batch?.maxSize ?? 100,
      concurrency: config.batch?.concurrency ?? 1,
    },
    async embed(texts) {
      const result = await aiEmbedMany({
        model: config.model,
        values: texts,
        maxRetries: config.maxRetries,
        maxParallelCalls: config.maxParallelCalls ?? 1,
        headers: config.headers,
        providerOptions: config.providerOptions as Parameters<typeof aiEmbedMany>[0]['providerOptions'],
      })

      return {
        embeddings: result.embeddings.map((embedding) => [...embedding]),
        usage: {
          inputTokens: result.usage.tokens,
          totalTokens: result.usage.tokens,
        },
      }
    },
  })
}

export function reranker(config: AIRerankerConfig): RetrieverReranker {
  return coreReranker({
    name: config.name,
    async rerank({ query, hits }) {
      if (hits.length === 0) return hits

      const result = await aiRerank({
        model: config.model,
        query,
        documents: hits.map((hit) => (config.document ? config.document(hit) : hit.content)),
        topN: config.topN,
        maxRetries: config.maxRetries,
      })

      return result.ranking.map(({ originalIndex, score }) => ({
        ...hits[originalIndex],
        score,
      }))
    },
  })
}

// ─────────────────────────────────────────────────────────────────
// Result Types
// ─────────────────────────────────────────────────────────────────

/** Resolve tools generic for result typing. */
type ResolvedTools<T extends ToolSet | undefined> = T extends ToolSet ? T : Record<string, never>

/** Stream result for text prompts. */
export type TextStreamResult<TTools extends ToolSet = Record<string, never>> = StreamTextResult<TTools, never>

/** Stream result for structured prompts. */
export type ObjectStreamResult<T> = StreamObjectResult<DeepPartial<T>, T, never>

// ─────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────

/** Shape of generate/stream call opts as seen by internal helpers. */
type CallOpts = Record<string, unknown> & {
  tools?: ToolSet
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[]
  messages?: ResolvedPrompt['messages']
  toolChoice?: ToolChoice<ToolSet>
  stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>
  activeTools?: string[]
  timeoutMs?: number
  validationRetry?: ValidationRetryOptions
  input?: Record<string, unknown>
}

/** Strip AI SDK-specific fields from opts to pass to `.resolve()`. */
function toResolveOpts(opts: CallOpts, modelInfo: ModelInfo): Record<string, unknown> {
  const {
    model: _model,
    tools: _tools,
    toolMiddleware: _tm,
    messages: _messages,
    toolChoice: _tc,
    stopWhen: _sw,
    activeTools: _at,
    ...rest
  } = opts as CallOpts & {
    model?: unknown
  }
  return {
    ...rest,
    provider: modelInfo.provider,
    modelId: modelInfo.modelId,
  }
}

/** SDK-specific args passed to `generateText`/`generateObject`/`streamText`/`streamObject`. */
type AIArgs = Record<string, unknown> & {
  model: LanguageModel
  system?: string | Array<{ role: 'system'; content: string; providerOptions?: Record<string, unknown> }>
  prompt?: string
  messages?: ResolvedPrompt['messages']
  schema?: unknown
  tools?: ToolSet
  toolChoice?: ToolChoice<ToolSet>
  stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>
  activeTools?: string[]
}

/** Build AI SDK args from resolved prompt + call opts. */
function toAIArgs(resolved: ResolvedPrompt, model: LanguageModel, callOpts: CallOpts, modelInfo?: ModelInfo): AIArgs {
  const args: AIArgs = {
    model,
    ...resolved.settings,
  }

  if (resolved.system) {
    // Convert systemBlocks to SystemModelMessage[] with providerOptions
    // for Anthropic models when any block has providerCache: true
    if (modelInfo && isAnthropicModel(modelInfo) && resolved.systemBlocks?.some((b) => b.providerCache)) {
      let breakpointCount = 0
      const MAX_BREAKPOINTS = 4
      args.system = resolved.systemBlocks.map((block) => {
        const msg: { role: 'system'; content: string; providerOptions?: Record<string, unknown> } = {
          role: 'system',
          content: block.text,
        }
        if (block.providerCache && breakpointCount < MAX_BREAKPOINTS) {
          breakpointCount++
          msg.providerOptions = {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          }
        }
        return msg
      })
    } else {
      args.system = resolved.system
    }
  }
  if (resolved.prompt) args.prompt = resolved.prompt
  if (resolved.messages) args.messages = resolved.messages
  if (callOpts.messages) {
    args.messages = callOpts.messages
    delete args.prompt
  }

  if (resolved.schema) {
    args.schema = resolved.schema
  }

  // Merge tools: resolved (context + config) < call-site, then instrument for devtools
  if (!resolved.schema) {
    const rawTools = {
      ...(resolved.tools ?? {}),
      ...(callOpts.tools ?? {}),
    } as ToolSet
    const toolMiddleware = normalizeToolMiddleware(resolved.toolMiddleware, callOpts.toolMiddleware)
    const mergedTools = instrumentTools(applyToolMiddleware(rawTools, toolMiddleware))
    if (mergedTools && Object.keys(mergedTools).length > 0) args.tools = mergedTools

    const toolChoice = callOpts.toolChoice ?? (resolved.toolChoice as ToolChoice<ToolSet> | undefined)
    if (toolChoice !== undefined) args.toolChoice = toolChoice

    const stopWhen = callOpts.stopWhen ?? (resolved.stopWhen as StopCondition<ToolSet> | undefined)
    if (stopWhen !== undefined) args.stopWhen = stopWhen

    if (callOpts.activeTools) args.activeTools = callOpts.activeTools
  }

  return args
}

function normalizeToolMiddleware(
  promptMiddleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
  callMiddleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
): readonly ToolMiddleware[] | undefined {
  const normalized = [
    ...(Array.isArray(promptMiddleware) ? promptMiddleware : promptMiddleware ? [promptMiddleware] : []),
    ...(Array.isArray(callMiddleware) ? callMiddleware : callMiddleware ? [callMiddleware] : []),
  ]
  return normalized.length > 0 ? normalized : undefined
}

// ─────────────────────────────────────────────────────────────────
// Tool Instrumentation (automatic, zero-config)
// ─────────────────────────────────────────────────────────────────

/**
 * Wrap each tool's `execute` function with timing + instrumentation hooks.
 *
 * This is called internally by `generate()` and `stream()` — consumer code
 * passes tools normally and Crux instruments them transparently.
 * No-op when devtools are not enabled (no hooks registered).
 */
/**
 * Structural shape of a tool's execute method. AI SDK's `Tool<INPUT, OUTPUT>`
 * is heavily generic; the wrapper is a passthrough, so structural typing
 * is sufficient here.
 */
type ToolExecute = (input: unknown, options: { toolCallId?: string; [key: string]: unknown }) => unknown
type ToolNeedsApproval = (
  input: unknown,
  options: { toolCallId?: string; [key: string]: unknown },
) => boolean | PromiseLike<boolean>
type ToolToModelOutput = (args: {
  toolCallId: string
  input: unknown
  output: unknown
}) => ToolModelOutput | Promise<ToolModelOutput>

function instrumentTools(tools: ToolSet | undefined): ToolSet | undefined {
  if (!tools) return tools
  const hooks = getRuntime().instrumentationHooks
  if (!hooks?.onToolStart && !hooks?.onToolEnd && !hooks?.onToolApprovalRequest) return tools

  const wrapped: Record<string, unknown> = {}
  for (const [name, tool] of Object.entries(tools)) {
    const toolLike = tool as {
      execute?: ToolExecute
      needsApproval?: boolean | ToolNeedsApproval
      toModelOutput?: ToolToModelOutput
    } | null
    const execute = toolLike?.execute
    const needsApproval = toolLike?.needsApproval
    if (!tool || (typeof execute !== 'function' && needsApproval === undefined)) {
      wrapped[name] = tool
      continue
    }
    const originalExecute: ToolExecute = execute ? execute : async () => undefined
    const originalNeedsApproval = needsApproval
    const originalToModelOutput = toolLike?.toModelOutput
    const pending = new Map<
      string,
      {
        start: number
        input: unknown
        output: unknown
        outputSize: number
      }
    >()
    wrapped[name] = {
      ...tool,
      ...(originalNeedsApproval === undefined
        ? {}
        : {
            needsApproval: async function instrumentedNeedsApproval(
              this: unknown,
              input: unknown,
              options: { toolCallId?: string; [key: string]: unknown },
            ) {
              const approved =
                typeof originalNeedsApproval === 'boolean'
                  ? originalNeedsApproval
                  : Boolean(await originalNeedsApproval.call(this, input, options))
              if (approved) {
                const toolCallId = options?.toolCallId ?? `tc_${Date.now()}`
                hooks.onToolApprovalRequest?.({
                  approvalId: `approval_${toolCallId}`,
                  toolCallId,
                  toolName: name,
                  input,
                })
              }
              return approved
            },
          }),
      ...(execute
        ? {
            execute: async function instrumentedExecute(
              this: unknown,
              input: unknown,
              options: { toolCallId?: string; [key: string]: unknown },
            ) {
              const toolCallId = options?.toolCallId ?? `tc_${Date.now()}`
              const start = Date.now()
              hooks.onToolStart?.({ toolCallId, toolName: name, args: input })
              try {
                const result = await originalExecute.call(this, input, options)
                const outputSize = measureToolPayload(result)
                if (originalToModelOutput) {
                  pending.set(toolCallId, { start, input, output: result, outputSize })
                } else {
                  const modelOutput = defaultToolModelOutput(result)
                  const modelOutputSize = measureToolPayload(modelOutput)
                  hooks.onToolEnd?.({
                    toolCallId,
                    toolName: name,
                    durationMs: Date.now() - start,
                    result,
                    modelOutput,
                    modelOutputType: modelOutput.type,
                    outputSize,
                    modelOutputSize,
                    tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
                  })
                }
                return result
              } catch (err) {
                hooks.onToolEnd?.({
                  toolCallId,
                  toolName: name,
                  durationMs: Date.now() - start,
                  error: err instanceof Error ? err.message : String(err),
                })
                throw err
              }
            },
          }
        : {}),
      ...(originalToModelOutput
        ? {
            toModelOutput: async function instrumentedToModelOutput(args: {
              toolCallId: string
              input: unknown
              output: unknown
            }) {
              const pendingTool = pending.get(args.toolCallId)
              try {
                const modelOutput = await originalToModelOutput.call(this, args)
                const outputSize = pendingTool?.outputSize ?? measureToolPayload(args.output)
                const modelOutputSize = measureToolPayload(modelOutput)
                hooks.onToolEnd?.({
                  toolCallId: args.toolCallId,
                  toolName: name,
                  durationMs: Date.now() - (pendingTool?.start ?? Date.now()),
                  result: pendingTool?.output ?? args.output,
                  modelOutput,
                  modelOutputType: modelOutput.type,
                  outputSize,
                  modelOutputSize,
                  tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
                })
                return modelOutput
              } catch (err) {
                hooks.onToolEnd?.({
                  toolCallId: args.toolCallId,
                  toolName: name,
                  durationMs: Date.now() - (pendingTool?.start ?? Date.now()),
                  result: pendingTool?.output ?? args.output,
                  outputSize: pendingTool?.outputSize ?? measureToolPayload(args.output),
                  modelOutputError: err instanceof Error ? err.message : String(err),
                  error: err instanceof Error ? err.message : String(err),
                })
                throw err
              } finally {
                pending.delete(args.toolCallId)
              }
            },
          }
        : {}),
    }
  }
  return wrapped as ToolSet
}

function defaultToolModelOutput(output: unknown): ToolModelOutput {
  return typeof output === 'string' ? { type: 'text', value: output } : { type: 'json', value: toJsonValue(output) }
}

function measureToolPayload(value: unknown): number {
  if (typeof value === 'string') return value.length
  try {
    return JSON.stringify(value ?? null).length
  } catch {
    return 0
  }
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return null
  return JSON.parse(serialized) as JsonValue
}

// ─────────────────────────────────────────────────────────────────
// generate()
// ─────────────────────────────────────────────────────────────────

/**
 * Execute a prompt using the Vercel AI SDK.
 *
 * - With `output` schema: calls `generateObject`, returns `GenerateObjectResult<O>`
 * - Without `output`: calls `generateText`, returns `GenerateTextResult`
 *
 * @example
 * ```ts
 * import { generate } from '@crux/ai'
 *
 * // Structured output
 * const result = await generate(editPrompt, { model, input: { ... } })
 * result.object // typed
 *
 * // Text output
 * const result = await generate(textPrompt, { model, input: { ... } })
 * result.text // string
 * ```
 */
/**
 * The model "shape" passed to the inner dispatch closures: after router/cascade
 * resolution it is either a raw `LanguageModel` or a `FallbackModel<LanguageModel>`.
 */
type DispatchModel = LanguageModel | FallbackModel<LanguageModel>

/** Return type for `generate()` — discriminates on the prompt's output schema. */
type GenerateReturn<TOutput extends z.ZodType | undefined> =
  TOutput extends z.ZodType<infer O> ? GenerateObjectResult<O> : GenerateTextResult<Record<string, never>, never>

export async function generate<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly Context<z.ZodType>[],
>(
  prompt: Prompt<TOwnInput, TOutput, TContexts>,
  opts: AIGenerateOptions<TOwnInput, TContexts>,
): Promise<GenerateReturn<TOutput>> {
  const callOpts = opts as unknown as CallOpts
  const input = callOpts.input ?? {}
  type R = GenerateReturn<TOutput>

  const runWithModel = (model: LanguageModel): Promise<R> =>
    generateSingle(prompt as AnyPrompt, { ...callOpts, model }) as Promise<R>

  const extractId = (model: LanguageModel): string => {
    const info = extractModelInfo(model)
    return info.modelId || info.provider
  }

  const tryDispatch = (model: DispatchModel): Promise<R> => {
    if (isFallback(model)) {
      return executeFallbackLoop(model, runWithModel, extractId)
    }
    return runWithModel(model)
  }

  // ── Router / Cascade path (may resolve to fallback internally) ──
  if (isRouter(opts.model) || isCascade(opts.model)) {
    return resolveModel<DispatchModel, R>(opts.model as DispatchModel, input, tryDispatch, (model) =>
      isFallback(model) ? 'fallback' : extractId(model),
    ) as Promise<R>
  }

  // ── Fallback path ──
  if (isFallback(opts.model)) {
    return executeFallbackLoop(opts.model, runWithModel, extractId)
  }

  // ── Standard (single model) path ──
  // Negative narrowing across `isRouter || isCascade` doesn't fully eliminate
  // `AnyRouterModel<LanguageModel>` from the union, so cast structurally here.
  return runWithModel(opts.model as LanguageModel)
}

/**
 * Structural shape of AI SDK generate/stream results we read in this adapter.
 * The actual `GenerateObjectResult` / `GenerateTextResult` types from the AI SDK
 * are union-typed and provider-specific; we narrow to the fields we touch.
 */
type SdkResultLike = {
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
    outputTokenDetails?: { reasoningTokens?: number }
  }
  finishReason?: string
  toolCalls?: Array<{ toolCallId: string; toolName: string; input?: unknown; args?: unknown }>
  response?: { id?: string; modelId?: string }
  providerMetadata?: unknown
  text?: string
  totalUsage?: SdkResultLike['usage']
  _meta?: Record<string, unknown>
}

/** A `generateObject` arg envelope that supports validation retry. */
type GenerateArgs = AIArgs & {
  experimental_repairText?: (input: { text: string; error: unknown }) => Promise<string | null>
}

async function withProviderTimeout<T>(
  timeoutMs: number | undefined,
  fn: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return fn()

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      const error = new Error(`AI provider call timed out after ${timeoutMs}ms`)
      error.name = 'AbortError'
      reject(error)
    }, timeoutMs)
  })

  try {
    return await Promise.race([fn(controller.signal), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Execute generation with a single model (the standard path).
 * Factored out so the fallback loop can call it per-model.
 */
async function generateSingle(prompt: AnyPrompt, opts: CallOpts & { model: LanguageModel }): Promise<SdkResultLike> {
  const modelInfo = extractModelInfo(opts.model)
  const resolveOpts = toResolveOpts(opts, modelInfo)
  const resolved = await prompt.resolve(resolveOpts as Parameters<typeof prompt.resolve>[0])
  const args = toAIArgs(resolved, opts.model, opts, modelInfo)

  // Compute inspect data for devtools (context composition, dropped contexts, etc.)
  try {
    const inspectResult = await prompt.inspect(resolveOpts as Parameters<typeof prompt.inspect>[0])
    // Merge call-site tool names into inspect (inspect() only knows prompt+context tools)
    if (args.tools) {
      const allToolNames = Object.keys(args.tools)
      if (allToolNames.length > 0) inspectResult.tools = allToolNames
    }
    ;(args as Record<string, unknown>)._inspect = inspectResult
  } catch {
    // inspect() failure should never block generation
  }

  // Sanitize schema for Anthropic (strip unsupported JSON Schema properties)
  if (args.schema && resolved.schema) {
    args.schema = await sanitizeSchemaForProvider(resolved.schema, modelInfo)
  }

  // Validation retry config
  const validationRetry = opts.validationRetry
  const maxValidationRetries = validationRetry?.maxRetries ?? 0

  const doGenerate = async (a: AIArgs): Promise<SdkResultLike> => {
    let result: SdkResultLike | undefined

    await withProviderTimeout(opts.timeoutMs, async (signal) => {
      const callArgs = signal ? ({ ...a, abortSignal: signal } as AIArgs) : a

      if (resolved.schema) {
        // Structured output — with validation retry support
        const generateArgs: GenerateArgs = { ...callArgs }

        // Tier 1: Use AI SDK's experimental_repairText for cheap text fixes
        if (validationRetry) {
          generateArgs.experimental_repairText = async ({ text }) => {
            const repaired = repairJsonText(text)
            return repaired !== text ? repaired : null
          }
        }

        // First attempt
        try {
          result = (await generateObject(
            generateArgs as Parameters<typeof generateObject>[0],
          )) as unknown as SdkResultLike
        } catch (firstError: unknown) {
          // If no validation retry configured, or not a validation error, rethrow
          if (!validationRetry || !isObjectGenerationError(firstError)) throw firstError

          // Tier 3: LLM retry with corrective feedback
          let lastError: unknown = firstError
          let retryCount = 0

          for (let attempt = 1; attempt <= maxValidationRetries; attempt++) {
            retryCount = attempt
            const errorMsg = lastError instanceof Error ? lastError.message : String(lastError)

            // Extract raw text from the error if available
            const errObj = lastError as { text?: unknown; response?: { text?: unknown } } | null
            const rawText =
              (typeof errObj?.text === 'string' ? errObj.text : '') ||
              (typeof errObj?.response?.text === 'string' ? errObj.response.text : '') ||
              ''

            validationRetry.onRetry?.(attempt, extractZodError(lastError))

            // Emit instrumentation hook
            const hooks = getRuntime().instrumentationHooks
            hooks?.onValidationRetryAttempt?.({
              retryId: `vr_ai_${Date.now()}`,
              attemptNumber: attempt,
              maxAttempts: maxValidationRetries,
              error: errorMsg,
              rawOutput: String(rawText).slice(0, 500),
              repairAttempted: true,
              repairSucceeded: false,
            })

            // Rebuild args with corrective message appended
            const retryArgs: GenerateArgs & { messages?: ResolvedPrompt['messages']; prompt?: string } = {
              ...generateArgs,
            }
            const corrective = `Your previous output failed validation: ${errorMsg}\n\nPlease fix these issues and return valid JSON.`
            if (retryArgs.messages) {
              retryArgs.messages = [
                ...retryArgs.messages,
                { role: 'assistant', content: rawText || 'Invalid output' },
                { role: 'user', content: corrective },
              ] as ResolvedPrompt['messages']
            } else if (retryArgs.prompt) {
              retryArgs.messages = [
                { role: 'user', content: retryArgs.prompt },
                { role: 'assistant', content: rawText || 'Invalid output' },
                { role: 'user', content: corrective },
              ] as ResolvedPrompt['messages']
              delete retryArgs.prompt
            }

            try {
              result = (await generateObject(
                retryArgs as Parameters<typeof generateObject>[0],
              )) as unknown as SdkResultLike
              break // Success
            } catch (retryError: unknown) {
              if (!isObjectGenerationError(retryError)) throw retryError
              lastError = retryError
            }
          }

          // If result is still undefined, all retries failed
          if (!result) {
            const zodError = extractZodError(lastError)
            const hooks = getRuntime().instrumentationHooks
            hooks?.onValidationRetryExhausted?.({
              retryId: `vr_ai_${Date.now()}`,
              totalAttempts: retryCount,
              lastError: lastError instanceof Error ? lastError.message : String(lastError),
              promptId: prompt.id ?? 'unknown',
            })
            validationRetry.onExhausted?.(retryCount, zodError)
            const errObj = lastError as { text?: unknown } | null
            throw new ValidationExhaustedError({
              lastRawOutput: typeof errObj?.text === 'string' ? errObj.text : '',
              zodErrors: zodError,
              attempts: retryCount,
              maxAttempts: maxValidationRetries,
              promptId: prompt.id ?? 'unknown',
            })
          }
        }
      } else {
        // Text output — no validation retry needed
        await notifyToolApprovalResponses(callArgs.tools as Record<string, unknown> | undefined, callArgs.messages)
        result = (await generateText(callArgs as Parameters<typeof generateText>[0])) as unknown as SdkResultLike
      }
    })

    // Attach normalized metadata for devtools extraction
    const finalResult = result as SdkResultLike
    finalResult._meta = {
      usage: finalResult.usage
        ? {
            inputTokens: finalResult.usage.inputTokens ?? 0,
            outputTokens: finalResult.usage.outputTokens ?? 0,
            totalTokens: finalResult.usage.totalTokens ?? 0,
            cacheReadTokens: finalResult.usage.inputTokenDetails?.cacheReadTokens,
            cacheWriteTokens: finalResult.usage.inputTokenDetails?.cacheWriteTokens,
            reasoningTokens: finalResult.usage.outputTokenDetails?.reasoningTokens,
          }
        : undefined,
      finishReason: finalResult.finishReason,
      toolCalls:
        finalResult.toolCalls && finalResult.toolCalls.length > 0
          ? finalResult.toolCalls.map((tc) => ({
              id: tc.toolCallId,
              name: tc.toolName,
              args: tc.input ?? tc.args,
            }))
          : undefined,
      responseId: finalResult.response?.id,
      actualModelId: finalResult.response?.modelId,
      cost: extractCost(finalResult.providerMetadata),
    }

    return finalResult
  }

  return orchestrateGenerate<AIArgs, SdkResultLike>(
    {
      promptId: prompt.id,
      promptConfig: prompt.config,
      preparedArgs: { ...args, input: opts.input },
      model: opts.model,
      input: opts.input ?? {},
      provider: modelInfo.provider,
      resolved,
      outputMode: resolved.schema ? 'object' : 'text',
      timeoutMs: opts.timeoutMs,
    },
    doGenerate,
  )
}

// ─────────────────────────────────────────────────────────────────
// stream()
// ─────────────────────────────────────────────────────────────────

/**
 * Stream a prompt using the Vercel AI SDK.
 *
 * - With `output` schema: calls `streamObject`, returns `ObjectStreamResult<O>`
 * - Without `output`: calls `streamText`, returns `TextStreamResult`
 */
/** Return type for `stream()` — discriminates on the prompt's output schema. */
type StreamReturn<TOutput extends z.ZodType | undefined> =
  TOutput extends z.ZodType<infer O> ? ObjectStreamResult<O> : TextStreamResult

export async function stream<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly Context<z.ZodType>[],
>(
  prompt: Prompt<TOwnInput, TOutput, TContexts>,
  opts: AIGenerateOptions<TOwnInput, TContexts>,
): Promise<StreamReturn<TOutput>> {
  // ── Cascade does not support streaming ──
  if (isCascade(opts.model)) {
    throw new Error(
      'cascade() does not support stream(). Use generate() instead — cascade needs full results for tier evaluation.',
    )
  }

  const callOpts = opts as unknown as CallOpts
  const input = callOpts.input ?? {}
  type R = StreamReturn<TOutput>

  const runWithModel = (model: LanguageModel): Promise<R> =>
    streamSingle(prompt as AnyPrompt, { ...callOpts, model }) as Promise<R>

  const extractId = (model: LanguageModel): string => {
    const info = extractModelInfo(model)
    return info.modelId || info.provider
  }

  // ── Router path (may resolve to fallback internally) ──
  if (isRouter(opts.model)) {
    return resolveModel<DispatchModel, R>(
      opts.model as DispatchModel,
      input,
      (model) => {
        if (isFallback(model)) {
          return executeFallbackLoop(model, runWithModel, extractId)
        }
        if (isCascade(model)) {
          throw new Error('cascade() does not support stream(). Use generate() instead.')
        }
        return runWithModel(model)
      },
      (model) => (isFallback(model) ? 'fallback' : extractId(model)),
    ) as Promise<R>
  }

  // ── Fallback path ──
  if (isFallback(opts.model)) {
    return executeFallbackLoop(opts.model, runWithModel, extractId)
  }

  // ── Standard (single model) path ──
  // Negative narrowing across `isRouter` / `isCascade` doesn't fully eliminate
  // `AnyRouterModel<LanguageModel>` from the union, so cast structurally here.
  return runWithModel(opts.model as LanguageModel)
}

/** Args envelope for streamText/streamObject, including caller-provided callbacks. */
type StreamArgs = AIArgs & {
  onChunk?: (event: SdkStreamChunkEvent) => unknown
  onFinish?: (event: SdkStreamFinishEvent) => unknown
}

/** Structural shape of `streamText`/`streamObject` `onChunk` events. */
interface SdkStreamChunkEvent {
  chunk?: { type?: string; textDelta?: string }
}

/** Structural shape of `streamText`/`streamObject` `onFinish` events. */
interface SdkStreamFinishEvent extends SdkResultLike {}

/** Structural shape of a streaming SDK result we attach `_meta` to. */
interface StreamResultLike {
  _meta?: Record<string, unknown>
}

/**
 * Stream with a single model (the standard path).
 */
async function streamSingle(prompt: AnyPrompt, opts: CallOpts & { model: LanguageModel }): Promise<StreamResultLike> {
  const modelInfo = extractModelInfo(opts.model)
  const resolveOpts = toResolveOpts(opts, modelInfo)
  const resolved = await prompt.resolve(resolveOpts as Parameters<typeof prompt.resolve>[0])
  const args = toAIArgs(resolved, opts.model, opts, modelInfo)

  // Compute inspect data for devtools (context composition, dropped contexts, etc.)
  try {
    const inspectResult = await prompt.inspect(resolveOpts as Parameters<typeof prompt.inspect>[0])
    // Merge call-site tool names into inspect (inspect() only knows prompt+context tools)
    if (args.tools) {
      const allToolNames = Object.keys(args.tools)
      if (allToolNames.length > 0) inspectResult.tools = allToolNames
    }
    ;(args as Record<string, unknown>)._inspect = inspectResult
  } catch {
    // inspect() failure should never block streaming
  }

  // Sanitize schema for Anthropic (strip unsupported JSON Schema properties)
  if (args.schema && resolved.schema) {
    args.schema = await sanitizeSchemaForProvider(resolved.schema, modelInfo)
  }

  const doStream = async (a: AIArgs): Promise<StreamResultLike> => {
    const aWithCallbacks = a as StreamArgs
    const streamStartTime = Date.now()
    let firstChunkTime: number | undefined
    let chunkCount = 0

    // Preserve caller's callbacks
    const callerOnChunk = aWithCallbacks.onChunk
    const callerOnFinish = aWithCallbacks.onFinish

    let sdkResult: StreamResultLike

    if (resolved.schema) {
      // streamObject — no onChunk, use onFinish for metrics
      let resolveCompletion!: (meta: Record<string, unknown>) => void
      let rejectCompletion!: (err: unknown) => void
      const completionPromise = new Promise<Record<string, unknown>>((res, rej) => {
        resolveCompletion = res
        rejectCompletion = rej
      })

      sdkResult = streamObject({
        ...a,
        onFinish: async (event: SdkStreamFinishEvent) => {
          try {
            const meta = {
              usage: event.usage
                ? {
                    inputTokens: event.usage.inputTokens ?? 0,
                    outputTokens: event.usage.outputTokens ?? 0,
                    totalTokens: event.usage.totalTokens ?? 0,
                  }
                : undefined,
              cost: extractCost(event.providerMetadata),
              streaming: {
                ttftMs: firstChunkTime != null ? firstChunkTime - streamStartTime : undefined,
                totalChunks: chunkCount,
              },
            }
            resolveCompletion(meta)
            await callerOnFinish?.(event)
          } catch (err) {
            rejectCompletion(err)
          }
        },
      } as Parameters<typeof streamObject>[0]) as unknown as StreamResultLike

      sdkResult._meta = { _streamCompletion: completionPromise }
    } else {
      // streamText — use onChunk + onFinish for metrics
      let resolveCompletion!: (meta: Record<string, unknown>) => void
      let rejectCompletion!: (err: unknown) => void
      const completionPromise = new Promise<Record<string, unknown>>((res, rej) => {
        resolveCompletion = res
        rejectCompletion = rej
      })

      const progress = getRuntime().streamProgressHook?.(observe.captureContext()?.traceId!)
      await notifyToolApprovalResponses(a.tools as Record<string, unknown> | undefined, a.messages)

      sdkResult = streamText({
        ...a,
        onChunk: async (event: SdkStreamChunkEvent) => {
          if (!firstChunkTime) firstChunkTime = Date.now()
          chunkCount++
          const textDelta = event.chunk?.type === 'text-delta' ? event.chunk.textDelta : undefined
          progress?.onChunk(textDelta)
          await callerOnChunk?.(event)
        },
        onFinish: async (event: SdkStreamFinishEvent) => {
          try {
            await progress?.flush()
            const durationMs = Date.now() - streamStartTime
            const tokensPerSecond =
              durationMs > 0 && event.totalUsage?.outputTokens
                ? Math.round((event.totalUsage.outputTokens / durationMs) * 1000)
                : undefined

            const meta = {
              usage: event.totalUsage
                ? {
                    inputTokens: event.totalUsage.inputTokens ?? 0,
                    outputTokens: event.totalUsage.outputTokens ?? 0,
                    totalTokens: event.totalUsage.totalTokens ?? 0,
                    cacheReadTokens: event.totalUsage.inputTokenDetails?.cacheReadTokens,
                    cacheWriteTokens: event.totalUsage.inputTokenDetails?.cacheWriteTokens,
                    reasoningTokens: event.totalUsage.outputTokenDetails?.reasoningTokens,
                  }
                : undefined,
              finishReason: event.finishReason,
              toolCalls:
                event.toolCalls && event.toolCalls.length > 0
                  ? event.toolCalls.map((tc) => ({
                      id: tc.toolCallId,
                      name: tc.toolName,
                      args: tc.input ?? tc.args,
                    }))
                  : undefined,
              responseId: event.response?.id,
              actualModelId: event.response?.modelId,
              cost: extractCost(event.providerMetadata),
              text: event.text,
              streaming: {
                ttftMs: firstChunkTime != null ? firstChunkTime - streamStartTime : undefined,
                tokensPerSecond,
                totalChunks: chunkCount,
              },
            }
            resolveCompletion(meta)
            await callerOnFinish?.(event)
          } catch (err) {
            progress?.dispose()
            rejectCompletion(err)
          }
        },
      } as Parameters<typeof streamText>[0]) as unknown as StreamResultLike

      sdkResult._meta = { _streamCompletion: completionPromise }
    }

    return sdkResult
  }

  return orchestrateStream<AIArgs, StreamResultLike>(
    {
      promptId: prompt.id,
      promptConfig: prompt.config,
      preparedArgs: { ...args, input: opts.input },
      input: opts.input ?? {},
      provider: modelInfo.provider,
      model: opts.model,
      resolved,
      outputMode: resolved.schema ? 'object' : 'text',
      timeoutMs: opts.timeoutMs,
      // Cached replay shape uses Promise-based text/textStream (the streaming surface);
      // `MiddlewareResult` declares `text?: string`, so cast at the boundary — runtime
      // consumers read the Promise-shaped fields, not `text` directly.
      createCachedStreamResult: ((cached) =>
        createCachedAIStreamResult(cached, Boolean(resolved.schema)) as unknown) as Parameters<
        typeof orchestrateStream<AIArgs, StreamResultLike>
      >[0]['createCachedStreamResult'],
    },
    doStream,
  )
}

/** Cached stream replay result shape matching the streaming `StreamResultLike` surface. */
interface CachedStreamReplayResult extends StreamResultLike {
  object?: Promise<unknown>
  text: Promise<string>
  textStream: AsyncIterable<string>
  fullStream: AsyncIterable<string>
}

function createCachedAIStreamResult(
  cached: { text?: string; object?: unknown; meta?: Record<string, unknown> },
  isObject: boolean,
): CachedStreamReplayResult {
  const text = cached.text ?? (cached.object !== undefined ? JSON.stringify(cached.object) : '')
  const cachedMeta = (cached.meta ?? {}) as Record<string, unknown>
  const existingSemanticCache = (cachedMeta.semanticCache as Record<string, unknown> | undefined) ?? {}
  const completion = Promise.resolve({
    ...cachedMeta,
    semanticCache: {
      ...existingSemanticCache,
      replay: true,
    },
  })

  async function* textIterator() {
    for (let index = 0; index < text.length; index += 64) {
      yield text.slice(index, index + 64)
    }
  }

  return {
    ...(isObject ? { object: Promise.resolve(cached.object) } : {}),
    text: Promise.resolve(text),
    textStream: textIterator(),
    fullStream: textIterator(),
    _meta: { ...cachedMeta, _streamCompletion: completion },
  }
}

// ─────────────────────────────────────────────────────────────────
// Framework-agnostic adapters
// ─────────────────────────────────────────────────────────────────

/**
 * AI SDK `generateObject` wrapped as a `GenerateObjectFn`.
 *
 * Use this when calling `@crux/core` APIs that expect a `GenerateObjectFn`
 * (e.g., `llmJudge().score()`, `extractKeyFacts()`).
 *
 * @example
 * ```ts
 * import { generateObjectFn } from '@crux/ai'
 * import { llmJudge } from '@crux/core/scoring'
 *
 * const judge = llmJudge({ ... })
 * const result = await judge.score(input, { generate: generateObjectFn, model })
 * ```
 */
export const generateObjectFn: GenerateObjectFn = async (options) => {
  const run = async (model: LanguageModel) => {
    const result = await generateObject({
      model,
      system: options.system,
      prompt: options.prompt,
      schema: options.schema,
    })
    return { object: result.object }
  }
  if (isRouter(options.model) || isCascade(options.model)) {
    const resolved = await resolveModel<LanguageModel, { object: unknown }>(
      options.model as unknown as LanguageModel,
      { prompt: options.prompt },
      run as (m: LanguageModel) => Promise<{ object: unknown }>,
      (model) => {
        const info = extractModelInfo(model)
        return info.modelId || info.provider
      },
    )
    return { object: resolved.object as Awaited<ReturnType<typeof run>>['object'] }
  }
  return run(options.model as LanguageModel)
}

/**
 * AI SDK `generateText` wrapped as a `GenerateTextFn`.
 *
 * Use this when calling `@crux/core` APIs that expect a `GenerateTextFn`
 * (e.g., `compactConversation()`, `summarizeMessages()`).
 *
 * @example
 * ```ts
 * import { generateTextFn } from '@crux/ai'
 * import { compactConversation } from '@crux/convex'
 *
 * await compactConversation({ generate: generateTextFn, model, ... })
 * ```
 */
export const generateTextFn: GenerateTextFn = async (options) => {
  const run = async (model: LanguageModel) => {
    const result = await generateText({
      model,
      system: options.system,
      prompt: options.prompt,
    })
    return { text: result.text }
  }
  if (isRouter(options.model) || isCascade(options.model)) {
    const resolved = await resolveModel<LanguageModel, { text: string }>(
      options.model as unknown as LanguageModel,
      { prompt: options.prompt },
      run,
      (model) => {
        const info = extractModelInfo(model)
        return info.modelId || info.provider
      },
    )
    return { text: resolved.text }
  }
  return run(options.model as LanguageModel)
}

// ─────────────────────────────────────────────────────────────────
// Re-exports from AI SDK
// ─────────────────────────────────────────────────────────────────

export { tool, stepCountIs, hasToolCall } from 'ai'
export type {
  LanguageModel,
  ToolSet,
  ToolChoice,
  StopCondition,
  CallSettings,
  GenerateObjectResult,
  GenerateTextResult,
} from 'ai'

// ─────────────────────────────────────────────────────────────────
// Agent composition re-exports
// ─────────────────────────────────────────────────────────────────

import { stepCountIs } from 'ai'
import { createCompositions } from '@crux/core/agent'
import type { AgentExecutor, AgentResult } from '@crux/core/agent'

/**
 * Create an `AgentExecutor` that uses the Vercel AI SDK `generate()` function.
 *
 * Resolves model as `agent.model ?? options.model`, merges tools,
 * and normalizes the result into an `AgentResult`.
 *
 * When `options.maxSteps` is greater than 1, the executor passes
 * `stopWhen: stepCountIs(maxSteps)` to enable multi-step tool use
 * via the AI SDK's native agentic loop.
 *
 * @returns An `AgentExecutor` bound to the AI SDK.
 *
 * @example
 * ```ts
 * import { createAIExecutor } from '@crux/ai'
 * import { createCompositions } from '@crux/core/agent'
 *
 * const executor = createAIExecutor()
 * const { parallel, pipeline, consensus } = createCompositions(executor)
 * ```
 */
export function createAIExecutor(): AgentExecutor {
  return async (agent, options) => {
    const model = (agent.model ?? options.model) as LanguageModel
    const start = Date.now()
    const generateOpts: CallOpts & { model: LanguageModel; stopWhen?: StopCondition<ToolSet> } = {
      model,
      input: options.input as Record<string, unknown>,
      tools: { ...agent.tools, ...options.tools } as ToolSet,
    }
    if (options.maxSteps != null && options.maxSteps > 1) {
      generateOpts.stopWhen = stepCountIs(options.maxSteps)
    }
    const result = (await generate(agent.prompt, generateOpts as Parameters<typeof generate>[1])) as SdkResultLike & {
      object?: unknown
    }
    const meta = result._meta as
      | { usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }
      | undefined
    return {
      agentId: agent.id,
      output: result.object ?? result.text,
      durationMs: Date.now() - start,
      usage: meta?.usage
        ? {
            inputTokens: meta.usage.inputTokens,
            outputTokens: meta.usage.outputTokens,
            totalTokens: meta.usage.totalTokens,
          }
        : undefined,
    }
  }
}

const _compositions = createCompositions(createAIExecutor())

/** Run multiple agents concurrently and merge results. */
export const parallel = _compositions.parallel

/** Chain agents sequentially with typed data flow. */
export const pipeline = _compositions.pipeline

/** Run multiple agents and pick a winner via voting. */
export const consensus = _compositions.consensus

/** Run a swarm of agents with peer-to-peer routing via tool calls. */
export const swarm = _compositions.swarm

// ─────────────────────────────────────────────────────────────────
// Validation Retry Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Check if an error is an object generation error (validation/parse failure).
 * AI SDK throws `NoObjectGeneratedError` when structured output fails.
 */
function isObjectGenerationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  // AI SDK's NoObjectGeneratedError or similar validation errors
  return (
    error.name === 'NoObjectGeneratedError' ||
    error.name === 'TypeValidationError' ||
    error.name === 'JSONParseError' ||
    error.message.includes('did not match the expected schema') ||
    error.message.includes('Failed to parse')
  )
}

/**
 * Extract a ZodError from an AI SDK validation error.
 * Falls back to a synthetic ZodError if the error doesn't carry one.
 */
function extractZodError(error: unknown): import('zod').ZodError {
  // AI SDK errors may carry .cause which is the original ZodError
  const cause = (error as { cause?: unknown } | null)?.cause
  if (cause && typeof cause === 'object' && 'issues' in cause) {
    return cause as import('zod').ZodError
  }

  // Fallback: create a synthetic ZodError from the error message
  const { ZodError } = require('zod') as typeof import('zod')
  const issues: import('zod').ZodIssue[] = [
    {
      code: 'custom',
      path: [],
      message: error instanceof Error ? error.message : String(error),
    },
  ]
  return new ZodError(issues)
}

export { agent, isAgent } from '@crux/core/agent'
export type { Agent, AgentConfig, AgentLike, AgentResult } from '@crux/core/agent'
export type { SwarmOptions, SwarmResult, SwarmHandoffEvent, SwarmHandoffContext } from '@crux/core/agent'
export { SwarmError } from '@crux/core/agent'
