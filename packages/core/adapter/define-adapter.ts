/**
 * `adapter()` — factory for creating provider adapters.
 *
 * Accepts an `AdapterSpec` (provider-specific hooks) and returns a factory
 * `(client: TClient) => CruxAdapter`. The adapter handles prompt resolution,
 * tool loops, settings mapping, and exposes `generate()`, `stream()`, plus
 * agent composition methods (parallel, pipeline, consensus, swarm).
 *
 * This is the shared infrastructure that future adapter rewrites will use.
 * Fallback chains and devtools hooks will be wired in here.
 *
 * @module
 */

import type { GenerationSettings, TraceMeta, AnyPrompt, MiddlewareResult } from '../types'

/**
 * Loosely-typed resolve options used at the adapter boundary.
 *
 * The adapter is generic over `AnyPrompt`, so the strongly-typed
 * `ResolveOptions<TOwnInput, TContexts>` shape is unreachable here — the
 * concrete input shape is only known to the original prompt definition.
 * We narrow from `unknown` once and reuse this contract for every call.
 */
type AdapterResolveOpts = Parameters<AnyPrompt['resolve']>[0]
import type { Message } from '../messages'
import type { AdapterSpec } from './spec'
import type { AdapterResponse, CallArgs, StreamHandle } from './types'
import { validateStructuredOutput, formatValidationFeedback } from './policy/validation-retry'
import { createToolLifecycle } from './tool/session'
import { createCompositions } from '../agent/create-compositions'
import { getRuntime } from '../runtime'
import type { AgentExecutor } from '../agent/executor'
import { ValidationExhaustedError } from '../validation-retry'
import type { ValidationRetryOptions } from '../validation-retry'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'
import { createSafety } from '../safety/session'
import { orchestrateGenerate, orchestrateStream } from '../orchestrate'
import type { ToolMiddleware } from '../tool-middleware'

// ─────────────────────────────────────────────────────────────────
// Generate Options
// ─────────────────────────────────────────────────────────────────

/** Options for adapter `generate()` calls. */
export interface AdapterGenerateOptions<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  /** Model identifier passed to the provider's API. */
  model: string
  /** Input for the prompt. */
  input?: Record<string, unknown>
  /** Provider identifier for adaptation matching. Defaults to spec.providerId. */
  provider?: string
  /** Token budget for system message. */
  tokenBudget?: number
  /** Maximum tool loop iterations. Default: 10. */
  maxSteps?: number
  /** Additional generation settings at call-site (highest precedence). */
  settings?: GenerationSettings
  /** Provider-specific extra options. */
  extra?: TExtra
  /** Additional messages to prepend (e.g., conversation history). */
  messages?: Message[]
  /** Additional tools to merge at call time after prompt/context tools. */
  tools?: Record<string, unknown>
  /** Tool middleware applied after prompt tools and call-site tools are merged. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[]
  /**
   * Validation-feedback retry for structured output.
   * When set, failed Zod schema validation triggers a retry with
   * the error injected as a corrective message. Each retry counts
   * as a step against the `maxSteps` budget.
   */
  validationRetry?: ValidationRetryOptions
  /**
   * Semantic constraints to check after structural (Zod) validation passes.
   * All constraints run in parallel; combined feedback is injected on retry.
   * Merged with per-prompt, context-level, and global constraints (per-call wins).
   */
  constraints?: Constraint[]
  /**
   * Shared cap on total constraint retries across all constraints.
   * Individual constraints also have their own `maxRetries`.
   */
  constraintMaxRetries?: number
  /**
   * Guardrails to run on input/output during generation.
   * Merged with per-prompt, context-level, and global guardrails (per-call wins).
   */
  guardrails?: Guardrail[]
}

/** Options for adapter `stream()` calls. */
export interface AdapterStreamOptions<
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> extends AdapterGenerateOptions<TExtra> {}

// ─────────────────────────────────────────────────────────────────
// Generate Result
// ─────────────────────────────────────────────────────────────────

/** Result of an adapter `generate()` call. */
export interface AdapterGenerateResult<TRawResponse> {
  /** The raw SDK response (provider-specific). */
  raw: TRawResponse
  /** Extracted text from the response. */
  text: string
  /** Normalized metadata (usage, finish reason, tool calls, etc.). */
  _meta: TraceMeta
  /** Number of tool loop iterations performed. */
  steps: number
  /** Provider-agnostic Crux message history, including approval request/resume messages. */
  messages: Message[]
}

// ─────────────────────────────────────────────────────────────────
// CruxAdapter
// ─────────────────────────────────────────────────────────────────

/** The adapter interface returned by the factory. */
export interface CruxAdapter<
  TClient,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Provider identifier from the spec. */
  readonly providerId: string

  /** Execute a prompt (non-streaming) with automatic tool loop. */
  generate(prompt: AnyPrompt, opts: AdapterGenerateOptions<TExtra>): Promise<AdapterGenerateResult<TRawResponse>>

  /** Execute a prompt (streaming). */
  stream(prompt: AnyPrompt, opts: AdapterStreamOptions<TExtra>): Promise<StreamHandle<TRawStream>>

  /** Run multiple agents concurrently and merge results. */
  parallel: ReturnType<typeof createCompositions>['parallel']

  /** Chain agents sequentially with typed data flow. */
  pipeline: ReturnType<typeof createCompositions>['pipeline']

  /** Run multiple agents and pick a winner via voting. */
  consensus: ReturnType<typeof createCompositions>['consensus']

  /** Run a swarm of agents with peer-to-peer routing via tool calls. */
  swarm: ReturnType<typeof createCompositions>['swarm']
}

function appendAssistantResultMessage(messages: Message[], response: AdapterResponse | undefined): Message[] {
  if (!response) return messages
  return [
    ...messages,
    {
      role: 'assistant' as const,
      content: response.text,
      ...(response.toolCalls ? { metadata: { toolCalls: response.toolCalls } } : {}),
    },
  ]
}

// ─────────────────────────────────────────────────────────────────
// adapter
// ─────────────────────────────────────────────────────────────────

/** Default maximum tool loop iterations. */
const DEFAULT_MAX_STEPS = 10

// ─────────────────────────────────────────────────────────────────
// Internal: synthetic text chunks for guarded streams
// ─────────────────────────────────────────────────────────────────

/**
 * When the safety stream rewrites or releases held text, the original
 * provider chunk no longer carries the right delta. The dialect yields a
 * synthetic chunk instead, and wraps `extractTextDelta` to read it.
 */
const SAFETY_TEXT_CHUNK = Symbol('crux.safety.textChunk')

interface SafetyTextChunk {
  readonly [SAFETY_TEXT_CHUNK]: true
  readonly text: string
}

function createSafetyTextChunk(text: string): SafetyTextChunk {
  return { [SAFETY_TEXT_CHUNK]: true, text }
}

function isSafetyTextChunk(chunk: unknown): chunk is SafetyTextChunk {
  return typeof chunk === 'object' && chunk !== null && SAFETY_TEXT_CHUNK in chunk
}

/**
 * Create a provider adapter from an `AdapterSpec`.
 *
 * Returns a factory function: `(client: TClient) => CruxAdapter`.
 * The returned adapter has `generate()`, `stream()`, and composition
 * methods (parallel, pipeline, consensus, swarm).
 *
 * @param spec - Provider-specific adapter specification.
 * @returns A factory that creates adapter instances bound to a client.
 *
 * @example
 * ```ts
 * const createMyAdapter = adapter({
 *   providerId: 'my-provider',
 *   call: async (client, args) => { ... },
 *   stream: async (client, args) => { ... },
 *   appendToolRound: (msgs, resp, results) => [...msgs, ...],
 *   mapSettings: (s) => ({ temperature: s.temperature }),
 * })
 *
 * const adapter = createMyAdapter(myClient)
 * const result = await adapter.generate(myPrompt, { model: 'gpt-4o', input: { ... } })
 * ```
 */
export function adapter<
  TClient,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
>(
  spec: AdapterSpec<TClient, TRawResponse, TRawStream, TExtra>,
): (client: TClient) => CruxAdapter<TClient, TRawResponse, TRawStream, TExtra> {
  return (client: TClient): CruxAdapter<TClient, TRawResponse, TRawStream, TExtra> => {
    // ── generate() ──────────────────────────────────────────────

    async function generate(
      prompt: AnyPrompt,
      opts: AdapterGenerateOptions<TExtra>,
    ): Promise<AdapterGenerateResult<TRawResponse>> {
      // 1. Resolve the prompt
      const resolveOpts: AdapterResolveOpts = {
        input: opts.input,
        provider: opts.provider ?? spec.providerId,
        modelId: opts.model,
        tokenBudget: opts.tokenBudget,
        ...(opts.settings ?? {}),
      } as AdapterResolveOpts

      const resolved = await prompt.resolve(resolveOpts)

      // 2. Map settings
      const mappedSettings = spec.mapSettings(resolved.settings)

      // 3. Tool lifecycle session — owns merge precedence, middleware
      // wrapping, the approval protocol, instrumentation emission, skill
      // re-arming, and memory capture.
      const lifecycle = createToolLifecycle({
        regime: 'core',
        resolved,
        call: { tools: opts.tools, toolMiddleware: opts.toolMiddleware },
        promptId: prompt.id,
        input: opts.input ?? {},
        reresolve: () => prompt.resolve(resolveOpts),
        appendToolRound: spec.appendToolRound,
        sanitizeToolSchema: spec.sanitizeToolSchema,
      })

      // 4. Build initial messages
      let messages: Message[] = [...(opts.messages ?? [])]
      if (messages.length === 0 && resolved.prompt) {
        messages.push({ role: 'user', content: resolved.prompt })
      } else if (messages.length === 0 && resolved.messages) {
        messages.push(...(resolved.messages as Message[]))
      }

      // 5. Build schema params
      let schemaParams: Record<string, unknown> | undefined
      if (resolved.schema && spec.wrapOutputSchema) {
        schemaParams = spec.wrapOutputSchema(resolved.schema)
      }

      // 6. Tool loop (with validation retry)
      const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
      let lastRaw: TRawResponse | undefined
      let lastExtracted: AdapterResponse | undefined
      let steps = 0

      // Validation retry state
      const validationRetry = opts.validationRetry
      const maxValidationRetries = validationRetry?.maxRetries ?? 0
      let validationRetries = 0
      const retryId = validationRetry ? `vr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : ''

      // Safety session — owns scope merging, phase ordering, the constraint
      // retry machine, suspension policy, audits, and hook emission.
      const safety = createSafety({
        call: {
          constraints: opts.constraints,
          guardrails: opts.guardrails,
          constraintMaxRetries: opts.constraintMaxRetries,
        },
        resolved: { constraints: resolved.constraints, guardrails: resolved.guardrails, metadata: resolved.metadata },
        promptId: prompt.id,
        model: opts.model,
        traceId: retryId || undefined,
        systemPrompt: resolved.system,
      })

      // Steering state amended by skill loads mid-loop.
      let currentSystem = resolved.system
      let currentSystemBlocks = resolved.systemBlocks

      // Resume protocol: notify approval-middleware decisions and replay
      // decided calls before the first provider call.
      messages = (await lifecycle.resume(messages)).messages

      const generated = await orchestrateGenerate(
        {
          promptId: prompt.id,
          promptConfig: prompt.config ?? ({} as typeof prompt.config),
          preparedArgs: {
            model: opts.model,
            system: currentSystem,
            systemBlocks: currentSystemBlocks,
            messages,
            settings: mappedSettings,
            schema: resolved.schema,
            schemaParams,
            tools: lifecycle.descriptors,
            extra: (opts.extra ?? {}) as TExtra,
            input: opts.input ?? {},
          },
          model: opts.model,
          input: opts.input ?? {},
          provider: spec.providerId,
          resolved,
          outputMode: resolved.schema ? 'object' : 'text',
        },
        async () => {
          // ── Input guardrails (before first provider call) ──
          messages = [...(await safety.guardInput({ messages })).messages]

          let lastCallArgs: CallArgs<TExtra> | undefined

          for (let step = 0; step < maxSteps; step++) {
            steps++

            const callArgs: CallArgs<TExtra> = {
              model: opts.model,
              system: currentSystem,
              systemBlocks: currentSystemBlocks,
              messages,
              settings: mappedSettings,
              schema: resolved.schema,
              schemaParams,
              // Re-read each step — a skill load re-arms the descriptors.
              tools: lifecycle.descriptors ? [...lifecycle.descriptors] : undefined,
              extra: (opts.extra ?? {}) as TExtra,
            }
            lastCallArgs = callArgs

            const { raw, extracted } = await spec.call(client, callArgs)
            lastRaw = raw
            lastExtracted = extracted

            // Check if there are tool calls to process
            if (extracted.toolCalls && extracted.toolCalls.length > 0) {
              // Branch A: Tool calls → execute tools, continue loop (existing behavior)
            } else if (resolved.schema && validationRetry) {
              // Branch B: No tool calls, schema present, validation retry enabled
              const validationResult = validateStructuredOutput(extracted.text, resolved.schema)

              if (validationResult.valid) {
                // Text may have been repaired (e.g., markdown fences stripped)
                const validText = validationResult.repairedText ?? extracted.text
                if (validText !== extracted.text) {
                  lastExtracted = { ...extracted, text: validText }
                }

                break // Valid output — constraints and output guards run post-loop
              }

              // Validation failed — check retry budget
              if (validationRetries < maxValidationRetries && step < maxSteps - 1) {
                validationRetries++
                validationRetry.onRetry?.(validationRetries, validationResult.error!)

                // Emit instrumentation hook
                const hooks = getRuntime().instrumentationHooks
                hooks?.onValidationRetryAttempt?.({
                  retryId,
                  attemptNumber: validationRetries,
                  maxAttempts: maxValidationRetries,
                  error: validationResult.error!.message,
                  rawOutput: extracted.text.slice(0, 500),
                  repairAttempted: validationResult.repairedText !== extracted.text,
                  repairSucceeded: false,
                })

                // Inject corrective feedback as messages
                messages = spec.appendToolRound(messages, extracted, [])
                messages = [
                  ...messages,
                  {
                    role: 'user' as const,
                    content: formatValidationFeedback(extracted.text, validationResult.error!),
                  },
                ]
                continue // Retry — consumes a step
              }

              // Retries exhausted — emit hook before throwing
              const hooks = getRuntime().instrumentationHooks
              hooks?.onValidationRetryExhausted?.({
                retryId,
                totalAttempts: validationRetries,
                lastError: validationResult.error!.message,
                promptId: prompt.id ?? 'unknown',
              })
              validationRetry.onExhausted?.(validationRetries, validationResult.error!)
              throw new ValidationExhaustedError({
                lastRawOutput: extracted.text,
                zodErrors: validationResult.error!,
                attempts: validationRetries,
                maxAttempts: maxValidationRetries,
                promptId: prompt.id ?? 'unknown',
              })
            } else {
              // Branch C: No tool calls, no validation retry — constraints
              // and output guards run post-loop via the safety session.
              break
            }

            // Continue with tool call processing (Branch A)
            if (!extracted.toolCalls || extracted.toolCalls.length === 0) continue

            // One round through the session: gate → execute → settle.
            const round = await lifecycle.executeRound(extracted, messages)
            messages = round.messages
            if (round.kind === 'suspended') {
              lastExtracted = { ...extracted, finishReason: 'tool_approval_required' }
              break
            }

            // LoadSkill side effect: re-resolve, augment system, re-arm
            // tools, refund the step.
            const amendment = await lifecycle.applySkillLoads(extracted.toolCalls)
            if (amendment) {
              currentSystem = amendment.system
              currentSystemBlocks = amendment.systemBlocks
              steps--
              step--
            }
          }

          // ── Output safety: constraints then output guards (after loop) ──
          // The session owns ordering and suspension policy — on
          // tool-approval suspension all output safety is skipped.
          if (lastExtracted) {
            const suspended = lastExtracted.finishReason === 'tool_approval_required'
            let parsed: unknown
            if (resolved.schema && !suspended) {
              try {
                parsed = JSON.parse(lastExtracted.text)
              } catch {
                parsed = undefined
              }
            }
            const finalOutput = await safety.finalizeOutput(
              { text: lastExtracted.text, parsed },
              async (corrective) => {
                // The only dialect-specific concern: how to re-call the model.
                messages = spec.appendToolRound(messages, lastExtracted!, [])
                messages = [...messages, ...corrective]
                const regen = await spec.call(client, { ...lastCallArgs!, messages })
                lastRaw = regen.raw
                lastExtracted = regen.extracted
                steps++
                if (resolved.schema) {
                  // Re-run structural validation on the regenerated output.
                  const reVal = validateStructuredOutput(regen.extracted.text, resolved.schema)
                  const reText = reVal.valid ? (reVal.repairedText ?? regen.extracted.text) : regen.extracted.text
                  if (reText !== regen.extracted.text) {
                    lastExtracted = { ...regen.extracted, text: reText }
                  }
                  let reParsed: unknown
                  try {
                    reParsed = JSON.parse(reText)
                  } catch {
                    reParsed = undefined
                  }
                  return { text: reText, parsed: reParsed }
                }
                return { text: regen.extracted.text, parsed: undefined }
              },
              { suspended, messages },
            )
            if (finalOutput.text !== lastExtracted.text) {
              lastExtracted = { ...lastExtracted, text: finalOutput.text }
            }
          }

          // 7. Build result
          const meta: TraceMeta = safety.stamp({
            usage: lastExtracted
              ? {
                  inputTokens: lastExtracted.usage.inputTokens,
                  outputTokens: lastExtracted.usage.outputTokens,
                  totalTokens: lastExtracted.usage.totalTokens,
                  cacheReadTokens: lastExtracted.usage.cacheReadTokens,
                  cacheWriteTokens: lastExtracted.usage.cacheWriteTokens,
                  reasoningTokens: lastExtracted.usage.reasoningTokens,
                }
              : undefined,
            finishReason: lastExtracted?.finishReason,
            toolCalls: lastExtracted?.toolCalls?.map((tc) => ({
              id: tc.id,
              name: tc.name,
              args: tc.args,
            })),
            responseId: lastExtracted?.responseId,
            actualModelId: lastExtracted?.actualModelId,
          })

          const resultMessages =
            lastExtracted?.finishReason === 'tool_approval_required'
              ? messages
              : appendAssistantResultMessage(messages, lastExtracted)

          return {
            raw: lastRaw!,
            text: lastExtracted?.text ?? '',
            _meta: meta,
            steps,
            messages: resultMessages,
          }
        },
      )

      await lifecycle.captureTurn({
        messages,
        assistantText: generated.text,
        toolCalls: generated._meta.toolCalls,
      })

      return generated
    }

    // ── stream() ──────────────────────────────────────────────

    async function streamFn(prompt: AnyPrompt, opts: AdapterStreamOptions<TExtra>): Promise<StreamHandle<TRawStream>> {
      // 1. Resolve the prompt
      const resolveOpts: AdapterResolveOpts = {
        input: opts.input,
        provider: opts.provider ?? spec.providerId,
        modelId: opts.model,
        tokenBudget: opts.tokenBudget,
        ...(opts.settings ?? {}),
      } as AdapterResolveOpts

      const resolved = await prompt.resolve(resolveOpts)

      // 2. Map settings
      const mappedSettings = spec.mapSettings(resolved.settings)

      // 3. Tool lifecycle session (descriptors + decision notifications +
      // memory capture; stream() never drives rounds).
      const lifecycle = createToolLifecycle({
        regime: 'core',
        resolved,
        call: { tools: opts.tools, toolMiddleware: opts.toolMiddleware },
        promptId: prompt.id,
        input: opts.input ?? {},
        appendToolRound: spec.appendToolRound,
        sanitizeToolSchema: spec.sanitizeToolSchema,
      })
      const tools = lifecycle.descriptors ? [...lifecycle.descriptors] : undefined
      // Approval decisions in the incoming history fire approvalMiddleware
      // callbacks on streamed runs too.
      await lifecycle.notifyDecisions(opts.messages)

      // 4. Build messages
      let messages: Message[] = [...(opts.messages ?? [])]
      if (messages.length === 0 && resolved.prompt) {
        messages.push({ role: 'user', content: resolved.prompt })
      } else if (messages.length === 0 && resolved.messages) {
        messages.push(...(resolved.messages as Message[]))
      }

      // Safety session — input guards run before the provider call; the
      // streaming sub-protocol guards the outgoing text deltas.
      const safety = createSafety({
        call: {
          constraints: opts.constraints,
          guardrails: opts.guardrails,
          constraintMaxRetries: opts.constraintMaxRetries,
        },
        resolved: { constraints: resolved.constraints, guardrails: resolved.guardrails, metadata: resolved.metadata },
        promptId: prompt.id,
        model: opts.model,
        systemPrompt: resolved.system,
      })
      messages = [...(await safety.guardInput({ messages })).messages]

      // 5. Build schema params
      let schemaParams: Record<string, unknown> | undefined
      if (resolved.schema && spec.wrapOutputSchema) {
        schemaParams = spec.wrapOutputSchema(resolved.schema)
      }

      // 6. Call spec.stream
      const callArgs: CallArgs<TExtra> = {
        model: opts.model,
        system: resolved.system,
        systemBlocks: resolved.systemBlocks,
        messages,
        settings: mappedSettings,
        schema: resolved.schema,
        schemaParams,
        tools,
        extra: (opts.extra ?? {}) as TExtra,
      }

      const handle = await orchestrateStream(
        {
          promptId: prompt.id,
          promptConfig: prompt.config ?? ({} as typeof prompt.config),
          preparedArgs: { ...callArgs, input: opts.input ?? {} },
          input: opts.input ?? {},
          provider: spec.providerId,
          model: opts.model,
          resolved,
          outputMode: resolved.schema ? 'object' : 'text',
          createCachedStreamResult: (cached) => createCachedStreamHandle(cached) as unknown as MiddlewareResult,
        },
        async () => spec.stream(client, callArgs),
      )

      // Every dialect stream() drives the session's streaming sub-protocol:
      // feed each text delta, forward emits, swallow holds, surface blocks
      // as stream errors, and seal at end-of-stream.
      const safetyStream = safety.enabled ? safety.openStream() : undefined

      let streamedAssistantText = ''
      async function* trackedRawStream() {
        type Chunk = Awaited<TRawStream extends AsyncIterable<infer T> ? T : never>
        for await (const chunk of handle.rawStream as AsyncIterable<unknown>) {
          const delta = handle.extractTextDelta(chunk)
          if (!safetyStream || delta === undefined || delta === '') {
            if (delta) streamedAssistantText += delta
            yield chunk as Chunk
            continue
          }
          const directive = await safetyStream.feed(delta)
          if (directive.kind === 'hold') continue
          streamedAssistantText += directive.content
          if (directive.content === delta) {
            yield chunk as Chunk
          } else if (directive.content.length > 0) {
            yield createSafetyTextChunk(directive.content) as Chunk
          }
        }
        if (safetyStream) {
          const seal = await safetyStream.finish()
          if (seal.pending.length > 0) {
            streamedAssistantText += seal.pending
            yield createSafetyTextChunk(seal.pending) as Chunk
          }
        }
      }

      return {
        ...handle,
        rawStream: trackedRawStream() as unknown as TRawStream & AsyncIterable<unknown>,
        extractTextDelta: (chunk: unknown) => (isSafetyTextChunk(chunk) ? chunk.text : handle.extractTextDelta(chunk)),
        completion: async () => {
          const meta = await handle.completion()
          const stamped = meta ? safety.stamp(meta) : meta
          // At-most-once is the session's job — no dialect flag needed.
          await lifecycle.captureTurn({
            messages,
            assistantText: streamedAssistantText || undefined,
            toolCalls: stamped?.toolCalls,
          })
          return stamped
        },
      }
    }

    // ── Agent executor ──────────────────────────────────────────

    const executor: AgentExecutor = async (agent, options) => {
      const model = (agent.model as string) ?? (options.model as string)
      const start = Date.now()

      // Merge agent tools + composition-level tools into the prompt
      // so the tool loop can pick them up from the resolved prompt.
      const mergedTools = { ...(agent.tools ?? {}), ...(options.tools ?? {}) }
      const promptWithTools: AnyPrompt =
        Object.keys(mergedTools).length > 0
          ? (Object.freeze({
              ...agent.prompt,
              tools: mergedTools,
              resolve: async (resolveOpts: AdapterResolveOpts) => {
                const resolved = await agent.prompt.resolve(resolveOpts)
                return { ...resolved, tools: { ...(resolved.tools ?? {}), ...mergedTools } }
              },
            }) as unknown as AnyPrompt)
          : agent.prompt

      const generateOpts: AdapterGenerateOptions<TExtra> = {
        model,
        input: options.input as Record<string, unknown>,
        maxSteps: options.maxSteps,
        validationRetry: options.validationRetry,
        extra: {} as TExtra,
      }

      const result = await generate(promptWithTools, generateOpts)

      return {
        agentId: agent.id,
        output: result.text,
        durationMs: Date.now() - start,
        usage: result._meta.usage
          ? {
              inputTokens: result._meta.usage.inputTokens,
              outputTokens: result._meta.usage.outputTokens,
              totalTokens: result._meta.usage.totalTokens,
            }
          : undefined,
      }
    }

    const compositions = createCompositions(executor)

    // ── Return frozen adapter ──────────────────────────────────

    return Object.freeze({
      providerId: spec.providerId,
      generate,
      stream: streamFn,
      parallel: compositions.parallel,
      pipeline: compositions.pipeline,
      consensus: compositions.consensus,
      swarm: compositions.swarm,
    })
  }
}

function createCachedStreamHandle(cached: {
  text?: string
  object?: unknown
  meta?: Record<string, unknown>
}): StreamHandle<AsyncIterable<{ text: string }>> {
  const text = cached.text ?? (cached.object !== undefined ? JSON.stringify(cached.object) : '')
  async function* rawStream() {
    for (let index = 0; index < text.length; index += 64) {
      yield { text: text.slice(index, index + 64) }
    }
  }
  return {
    rawStream: rawStream(),
    extractTextDelta: (chunk: unknown) => (chunk as { text?: string }).text,
    completion: async () => {
      const meta = (cached.meta ?? {}) as TraceMeta
      const semanticCache =
        (cached.meta as { semanticCache?: Record<string, unknown> } | undefined)?.semanticCache ?? {}
      return {
        ...meta,
        semanticCache: { ...semanticCache, replay: true },
      } as TraceMeta
    },
  }
}
