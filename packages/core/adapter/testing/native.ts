/**
 * Conformance utilities for native `AdapterSpec` implementations.
 *
 * Native adapters own provider wire formats, while Crux owns the canonical
 * `CallArgs`, `AdapterResponse`, and tool-round transcript. This module turns
 * that boundary into an executable contract that provider packages can run
 * against SDK-shaped fake clients.
 *
 * @module
 */

import { z } from 'zod'
import type { GenerationSettings } from '../../types'
import type { Message } from '../../messages'
import type { AdapterSpec } from '../spec'
import type { AdapterResponse, CallArgs, ToolResultEntry } from '../types'
import type { ConformanceViolation } from '../testing'
import type {
  AdapterConformanceCapabilities,
  AdapterConformanceHarness,
  AdapterConformancePrepared,
} from './native-types'

export type {
  AdapterConformanceCapabilities,
  AdapterConformanceEmission,
  AdapterConformanceHarness,
  AdapterConformanceInspector,
  AdapterConformancePrepared,
  AdapterConformanceScript,
} from './native-types'

const SETTINGS_SAMPLE: GenerationSettings = {
  temperature: 0.25,
  maxTokens: 128,
  topP: 0.9,
  stopSequences: ['END'],
  presencePenalty: 0.1,
}

const BASE_MESSAGES: readonly Message[] = [{ role: 'user', content: 'Run the conformance scenario.' }]
const SAMPLE_USAGE = { inputTokens: 13, outputTokens: 8, totalTokens: 21 } as const

/**
 * Run the native adapter contract suite against an `AdapterSpec`.
 *
 * The suite calls the spec directly, never internal provider helpers. It
 * checks normalized responses, provider request capture, canonical
 * tool-round appends, settings mapping, structured-output request wiring,
 * and streaming delta extraction.
 *
 * @param spec - Native provider adapter implementation under test.
 * @param harness - Provider fake-client bridge for scripted raw responses.
 * @returns Contract violations; an empty array means the adapter conforms.
 *
 * @example
 * ```ts
 * const violations = await adapterSpecConformance(openaiSpec, openaiHarness)
 * expect(violations).toEqual([])
 * ```
 */
export async function adapterSpecConformance<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
>(
  spec: AdapterSpec<TClient, TRawResponse, TRawStream, TExtra>,
  harness: AdapterConformanceHarness<TClient, TRawResponse, TRawStream, TExtra>,
): Promise<ConformanceViolation[]> {
  const violations: ConformanceViolation[] = []
  const fail = (rule: string, detail: string) => violations.push({ rule, detail })
  const run = async (rule: string, check: () => Promise<void>) => {
    try {
      await check()
    } catch (error) {
      fail(rule, error instanceof Error ? error.message : String(error))
    }
  }

  await run('no-tool response normalization', async () => {
    const prepared = await harness.prepare({ emissions: [{ text: 'plain response', usage: SAMPLE_USAGE }] })
    const result = await spec.call(prepared.client, baseCallArgs(prepared))
    assertResponse(result.extracted, {
      rule: 'no-tool response normalization',
      fail,
      text: 'plain response',
      usage: SAMPLE_USAGE,
      toolCalls: false,
      capabilities: harness.capabilities,
    })
    if (prepared.inspect.calls().length !== 1) fail('provider request capture', 'expected one captured call')
    if (prepared.inspect.bodyForCall(0) === undefined) fail('provider request capture', 'first call body is missing')
  })

  await run('tool-call extraction and transcript append', async () => {
    const prepared = await harness.prepare({
      emissions: [
        { text: '', toolCalls: [{ id: 'call_weather', name: 'weather', args: { city: 'Paris' } }] },
        { text: 'It is mild.' },
      ],
    })
    const first = await spec.call(prepared.client, baseCallArgs(prepared))
    assertResponse(first.extracted, {
      rule: 'tool-call extraction',
      fail,
      text: '',
      toolCalls: true,
      capabilities: harness.capabilities,
    })
    const toolCallId = first.extracted.toolCalls?.[0]?.id ?? 'call_weather'
    const messages = spec.appendToolRound([...BASE_MESSAGES], first.extracted, [toolResult(toolCallId)])
    if (!messages.some(hasAssistantToolCalls)) fail('tool-round append', 'assistant tool call message missing')
    if (!messages.some(hasToolResult(toolCallId))) fail('tool-round append', 'tool result message missing')

    const second = await spec.call(prepared.client, baseCallArgs(prepared, { messages }))
    if (second.extracted.text !== 'It is mild.') {
      fail('tool-round second call', `expected final text "It is mild.", got "${second.extracted.text}"`)
    }
    if (prepared.inspect.messagesForCall(1) === undefined) {
      fail('tool-round second call', 'provider-native second-call messages were not captured')
    }
  })

  await run('settings mapping', async () => {
    const mapped = spec.mapSettings(SETTINGS_SAMPLE)
    if (mapped.temperature !== SETTINGS_SAMPLE.temperature) {
      fail('settings mapping', 'temperature must preserve its canonical value')
    }
    if ('maxTokens' in mapped) fail('settings mapping', 'maxTokens must be mapped or intentionally omitted')
    for (const [key, value] of Object.entries(mapped)) {
      if (value === undefined) fail('settings mapping', `mapped setting "${key}" is undefined`)
    }
  })

  await run('structured output request wiring', async () => {
    if (!spec.wrapOutputSchema) {
      if (harness.capabilities?.structuredOutput === 'required') {
        fail('structured output request wiring', 'wrapOutputSchema is required but missing')
      }
      return
    }
    const schema = z.object({ ok: z.boolean() })
    const schemaParams = spec.wrapOutputSchema(schema)
    const prepared = await harness.prepare({ structuredTexts: ['{"ok":true}'] })
    const result = await spec.call(prepared.client, baseCallArgs(prepared, { schema, schemaParams }))
    if (prepared.inspect.bodyForCall(0) === undefined) {
      fail('structured output request wiring', 'structured request body was not captured')
    }
    if (!looksLikeJsonObject(result.extracted.text)) {
      fail('structured output normalization', `expected JSON object text, got "${result.extracted.text}"`)
    }
  })

  await run('stream text deltas', async () => {
    const prepared = await harness.prepare({ streamChunks: ['he', 'llo'] })
    const handle = await spec.stream(prepared.client, baseCallArgs(prepared))
    let text = ''
    for await (const chunk of handle.rawStream as AsyncIterable<unknown>) {
      text += handle.extractTextDelta(chunk) ?? ''
    }
    if (text !== 'hello') fail('stream text deltas', `expected "hello", got "${text}"`)
    const completion = await handle.completion()
    if (harness.capabilities?.streamCompletion === 'required' && !completion) {
      fail('stream completion metadata', 'completion metadata is required but missing')
    }
  })

  return violations
}

function baseCallArgs<TClient, TExtra extends Record<string, unknown>>(
  prepared: AdapterConformancePrepared<TClient, TExtra>,
  overrides: Partial<CallArgs<TExtra>> = {},
): CallArgs<TExtra> {
  return {
    model: prepared.model,
    system: 'You are a conformance test.',
    systemBlocks: undefined,
    messages: [...BASE_MESSAGES],
    settings: {},
    schema: undefined,
    schemaParams: undefined,
    tools: undefined,
    extra: prepared.extra ?? ({} as TExtra),
    ...overrides,
  }
}

function toolResult(toolCallId: string): ToolResultEntry {
  return {
    toolCallId,
    name: 'weather',
    output: { temperature: 18 },
    modelOutput: { type: 'text', value: '18 C and cloudy' },
    content: '18 C and cloudy',
    outputSize: 25,
    modelOutputSize: 15,
  }
}

function assertResponse(
  response: AdapterResponse,
  opts: {
    readonly rule: string
    readonly fail: (rule: string, detail: string) => void
    readonly text: string
    readonly usage?: typeof SAMPLE_USAGE
    readonly toolCalls: boolean
    readonly capabilities: AdapterConformanceCapabilities | undefined
  },
) {
  if (response.text !== opts.text) opts.fail(opts.rule, `expected text "${opts.text}", got "${response.text}"`)
  if (opts.toolCalls && (!response.toolCalls || response.toolCalls.length === 0)) {
    opts.fail(opts.rule, 'expected canonical tool calls')
  }
  if (!opts.toolCalls && response.toolCalls !== undefined) opts.fail(opts.rule, 'expected no tool calls')
  if (opts.usage && JSON.stringify(response.usage) !== JSON.stringify(opts.usage)) {
    opts.fail(opts.rule, `expected usage ${JSON.stringify(opts.usage)}, got ${JSON.stringify(response.usage)}`)
  }
  if (!response.finishReason) opts.fail(opts.rule, 'finishReason was not normalized')
  if (opts.capabilities?.responseId === 'required' && !response.responseId) {
    opts.fail(opts.rule, 'responseId was not normalized')
  }
  if (opts.capabilities?.actualModelId === 'required' && !response.actualModelId) {
    opts.fail(opts.rule, 'actualModelId was not normalized')
  }
}

function hasAssistantToolCalls(message: Message): boolean {
  return message.role === 'assistant' && Array.isArray(message.metadata?.toolCalls)
}

function hasToolResult(toolCallId: string): (message: Message) => boolean {
  return (message) => message.role === 'tool' && message.metadata?.toolCallId === toolCallId
}

function looksLikeJsonObject(text: string): boolean {
  try {
    return typeof JSON.parse(text) === 'object' && text.trim().startsWith('{')
  } catch {
    return false
  }
}
