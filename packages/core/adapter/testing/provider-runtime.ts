/**
 * Runtime-level provider adapter conformance.
 *
 * This suite exercises the public runtime returned by
 * `defineSingleTurnProviderBundle()` or `defineProviderRuntime()` instead of
 * provider internals. Harnesses translate abstract scripts into provider SDK
 * fakes, while this runner owns the canonical Crux behavior: generation,
 * structured output, tool continuation, approval suspension, and streaming.
 *
 * @module
 */

import { z } from 'zod'
import { prompt as makePrompt } from '../../prompt/prompt'
import { appendToolApprovalResponse } from '../../tools/approvals'
import type { DefinedProviderRuntime, ProviderRuntimeDepsArg } from '../provider-runtime'
import type { ConformanceViolation } from '../testing'
import type {
  ProviderRuntimeConformanceGenerateOptions,
  ProviderRuntimeConformanceHarness,
  ProviderRuntimeConformanceRuntime,
} from './provider-runtime-types'

export type {
  ProviderConformanceEmission,
  ProviderConformancePrepared,
  ProviderConformanceScript,
  ProviderRuntimeConformanceCapabilities,
  ProviderRuntimeConformanceGenerateOptions,
  ProviderRuntimeConformanceGenerateResult,
  ProviderRuntimeConformanceHarness,
  ProviderRuntimeConformanceRuntime,
  ProviderRuntimeConformanceStreamHandle,
} from './provider-runtime-types'

const TEXT_INPUT = { instruction: 'Run the conformance scenario.' } as const
const TOOL_INPUT = { instruction: 'Use the echo tool.' } as const
const STREAM_INPUT = { instruction: 'Stream a greeting.' } as const

const textPrompt = makePrompt({
  id: 'crux-provider-conformance-text',
  system: 'You are a provider-runtime conformance test.',
  prompt: ({ input }) => input.instruction,
  input: z.object({ instruction: z.string() }),
})

const structuredPrompt = makePrompt({
  id: 'crux-provider-conformance-structured',
  system: 'Return a JSON object.',
  prompt: ({ input }) => input.instruction,
  input: z.object({ instruction: z.string() }),
  output: z.object({ ok: z.boolean() }),
})

/**
 * Run the provider-runtime contract suite against a public provider runtime.
 *
 * The runner binds the supplied `DefinedProviderRuntime` through `create()`
 * for every case, then calls only public `generate()` and `stream()` methods.
 * Provider packages supply a harness that scripts SDK-shaped fake clients.
 *
 * @param runtime - Provider runtime under test.
 * @param harness - Provider-owned script-to-SDK fake bridge.
 * @returns Contract violations; an empty array means the runtime conforms.
 *
 * @example
 * ```ts
 * const violations = await providerRuntimeConformance(openaiProviderRuntime, openAIHarness())
 * expect(violations).toEqual([])
 * ```
 */
export async function providerRuntimeConformance<
  TClient,
  TModel = string,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TRuntime extends ProviderRuntimeConformanceRuntime<TModel> = ProviderRuntimeConformanceRuntime<TModel>,
  TExtensions extends object = object,
>(
  runtime: DefinedProviderRuntime<TClient, TModel, TRawResponse, TRawStream, TExtra, TDeps, TRuntime, TExtensions>,
  harness: ProviderRuntimeConformanceHarness<TClient, TModel, TDeps>,
): Promise<ConformanceViolation[]> {
  const violations: ConformanceViolation[] = []
  const capabilities = harness.capabilities
  const fail = (rule: string, detail: string) => violations.push({ rule, detail })
  const run = async (rule: string, check: () => Promise<void>) => {
    try {
      await check()
    } catch (error) {
      fail(rule, error instanceof Error ? error.message : String(error))
    }
  }

  if (capabilities?.ownership && capabilities.ownership !== runtime.ownership) {
    fail('runtime ownership', `expected ${capabilities.ownership}, got ${runtime.ownership}`)
    return violations
  }

  await run('text generation', async () => {
    const prepared = await harness.prepare({ emissions: [{ text: 'plain response' }] })
    const result = await bindRuntime(runtime, prepared).generate(textPrompt, baseOptions(prepared.model))

    if (result.text !== 'plain response') fail('text generation', `expected "plain response", got "${result.text}"`)
    if (result.steps < 1) fail('text generation', `expected at least one step, got ${result.steps}`)
    if (!result._meta.finishReason) fail('text generation', 'finishReason was not normalized')
    if (typeof result._meta.usage?.totalTokens !== 'number') {
      fail('text generation', 'usage was not normalized')
    }
    if (prepared.inspect && prepared.inspect.bodyForCall(0) === undefined) {
      fail('provider request capture', 'first provider request body is missing')
    }
  })

  if (capabilities?.structuredOutput) {
    await run('structured output', async () => {
      const prepared = await harness.prepare({ structuredTexts: ['{"ok":true}'] })
      const result = await bindRuntime(runtime, prepared).generate(structuredPrompt, baseOptions(prepared.model))

      if (JSON.stringify(result.object) !== '{"ok":true}') {
        fail('structured output', `expected parsed object {"ok":true}, got ${JSON.stringify(result.object)}`)
      }
    })

    await run('structured validation retry', async () => {
      const prepared = await harness.prepare({ structuredTexts: ['{"ok":"no"}', '{"ok":true}'] })
      const result = await bindRuntime(runtime, prepared).generate(structuredPrompt, {
        ...baseOptions(prepared.model),
        validationRetry: { maxRetries: 2 },
      })

      if (JSON.stringify(result.object) !== '{"ok":true}') {
        fail('structured validation retry', `expected parsed object {"ok":true}, got ${JSON.stringify(result.object)}`)
      }

      const retryMessages = prepared.inspect?.messagesForCall(1)
      if (retryMessages !== undefined && !JSON.stringify(retryMessages).includes('Validation failed')) {
        fail('structured validation retry', 'retry request did not include validation feedback')
      }
    })
  }

  if (capabilities?.toolCalls) {
    await run('tool-call continuation', async () => {
      const prepared = await harness.prepare({
        emissions: [
          { text: '', toolCalls: [{ id: 'call_echo', name: 'echo', args: { value: 'hello' } }] },
          { text: 'tool complete' },
        ],
      })
      const result = await bindRuntime(runtime, prepared).generate(textPrompt, {
        ...baseOptions(prepared.model),
        input: TOOL_INPUT,
        maxSteps: 5,
        tools: {
          echo: echoTool(),
        },
      })

      if (result.text !== 'tool complete') {
        fail('tool-call continuation', `expected "tool complete", got "${result.text}"`)
      }
      if (result.steps < 2) fail('tool-call continuation', `expected at least 2 steps, got ${result.steps}`)
      if (!result.messages.some((message) => message.role === 'tool')) {
        fail('tool-call continuation', 'canonical transcript did not include a tool result message')
      }
    })
  }

  if (capabilities?.approvalSuspension) {
    await run('approval suspension', async () => {
      let executed = false
      const prepared = await harness.prepare({
        emissions: [
          { text: 'approval needed', toolCalls: [{ id: 'call_guarded', name: 'guarded', args: {} }] },
          { text: 'approved complete' },
        ],
      })
      const bound = bindRuntime(runtime, prepared)
      const guardedTools = {
        guarded: {
          ...echoTool(),
          needsApproval: true,
          execute: async () => {
            executed = true
            return 'approved output'
          },
        },
      }
      const result = await bound.generate(textPrompt, {
        ...baseOptions(prepared.model),
        tools: guardedTools,
      })

      if (executed) fail('approval suspension', 'approval-needing tool executed before approval')
      if (!result.pendingApprovals || result.pendingApprovals.length === 0) {
        fail('approval suspension', 'expected pending approval requests')
      }
      if (result._meta.finishReason !== 'tool_approval_required') {
        fail(
          'approval suspension',
          `expected finishReason "tool_approval_required", got "${result._meta.finishReason}"`,
        )
      }

      const approval = firstApproval(result.pendingApprovals)
      if (!approval) {
        fail('approval resume', 'pending approval did not expose approvalId and approvalToken')
        return
      }

      const resumed = await bound.generate(textPrompt, {
        ...baseOptions(prepared.model),
        tools: guardedTools,
        messages: appendToolApprovalResponse(result.messages, {
          approvalId: approval.approvalId,
          approved: true,
          approvalToken: approval.approvalToken,
        }),
      })

      if (!executed) fail('approval resume', 'approved tool did not execute on resume')
      if (resumed.text !== 'approved complete') {
        fail('approval resume', `expected "approved complete", got "${resumed.text}"`)
      }
    })
  }

  if (capabilities?.observerDirectives) {
    await run('observer stop directive', async () => {
      let observed = 0
      const prepared = await harness.prepare({
        emissions: [
          { text: 'stop here', toolCalls: [{ id: 'call_observe', name: 'echo', args: { value: 'observed' } }] },
          { text: 'should not run' },
        ],
      })
      const result = await bindRuntime(runtime, prepared).generate(textPrompt, {
        ...baseOptions(prepared.model),
        maxSteps: 5,
        tools: { echo: echoTool() },
        observer: {
          onStepFinish: async () => {
            observed++
            return { kind: 'stop', reason: 'conformance' }
          },
        },
      })

      if (observed !== 1) fail('observer stop directive', `expected one observed step, got ${observed}`)
      if (result.steps !== 1) fail('observer stop directive', `expected one step, got ${result.steps}`)
      if (result.text !== 'stop here') {
        fail('observer stop directive', `expected stopped text "stop here", got "${result.text}"`)
      }
    })
  }

  if (capabilities?.streaming) {
    await run('streaming', async () => {
      const prepared = await harness.prepare({ streamChunks: ['he', 'llo'] })
      const handle = await bindRuntime(runtime, prepared).stream(textPrompt, {
        ...baseOptions(prepared.model),
        input: STREAM_INPUT,
      })

      if (handle.rawStream && handle.extractTextDelta) {
        const text = await drainText(handle.rawStream, handle.extractTextDelta)
        if (text !== 'hello') fail('streaming', `expected streamed text "hello", got "${text}"`)
      } else if (!('raw' in handle)) {
        fail('streaming', 'stream handle exposed neither rawStream nor raw')
      }

      if (typeof handle.completion !== 'function') fail('streaming', 'stream handle is missing completion()')
      const consumedRawText = await consumeKnownRawStream(handle.raw)
      const completion = handle.rawStream || consumedRawText ? await handle.completion() : undefined
      if (completion !== undefined && (typeof completion !== 'object' || completion === null)) {
        fail('streaming completion metadata', 'completion metadata must be object-shaped when present')
      }
    })
  }

  return violations
}

function baseOptions<TModel>(model: TModel): ProviderRuntimeConformanceGenerateOptions<TModel> {
  return {
    model,
    input: TEXT_INPUT,
    settings: { temperature: 0.2, maxTokens: 64 },
  }
}

function echoTool() {
  const inputSchema = z.object({ value: z.string().optional() })
  return {
    description: 'Echo a value back to the model.',
    inputSchema,
    parameters: inputSchema,
    execute: async (input: unknown) => input,
  }
}

function bindRuntime<
  TClient,
  TModel,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown>,
  TRuntime extends ProviderRuntimeConformanceRuntime<TModel>,
  TExtensions extends object,
>(
  runtime: DefinedProviderRuntime<TClient, TModel, TRawResponse, TRawStream, TExtra, TDeps, TRuntime, TExtensions>,
  prepared: {
    readonly client: TClient
    readonly deps?: TDeps
  },
): TRuntime & TExtensions {
  if (prepared.deps === undefined) {
    return runtime.create(prepared.client, ...([] as unknown as ProviderRuntimeDepsArg<TDeps>))
  }
  return runtime.create(prepared.client, ...([prepared.deps] as unknown as ProviderRuntimeDepsArg<TDeps>))
}

function firstApproval(values: readonly unknown[] | undefined):
  | {
      readonly approvalId: string
      readonly approvalToken?: string
    }
  | undefined {
  const first = values?.[0]
  if (!isRecord(first) || typeof first.approvalId !== 'string') return undefined
  return {
    approvalId: first.approvalId,
    ...(typeof first.approvalToken === 'string' ? { approvalToken: first.approvalToken } : {}),
  }
}

async function drainText(
  stream: AsyncIterable<unknown>,
  extractTextDelta: (chunk: unknown) => string | undefined,
): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    text += extractTextDelta(chunk) ?? ''
  }
  return text
}

async function consumeKnownRawStream(raw: unknown): Promise<string | undefined> {
  const textStream = isRecord(raw) ? raw.textStream : undefined
  if (!isAsyncIterable(textStream)) return undefined

  let text = ''
  for await (const chunk of textStream) {
    if (typeof chunk === 'string') text += chunk
  }
  return text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { readonly [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
}
