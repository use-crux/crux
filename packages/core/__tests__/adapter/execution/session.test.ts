import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../../prompt/prompt'
import { validateStructuredOutput } from '../../../adapter/policy/validation-retry'
import type { Message } from '../../../messages'
import type { ModelInfo } from '../../../types'
import type { AdapterResponse, CallArgs, StreamHandle } from '../../../adapter/types'
import type { AdapterSpec } from '../../../adapter/spec'
import type { ExecutorSpec } from '../../../adapter/executor-spec'
import type { ExecutorRequest } from '../../../adapter/executor-types'
import type { AdapterExecutionDialect } from '../../../adapter/execution/session'
import { coreStepDialect, createAdapterExecution, sdkLoopDialect } from '../../../adapter/execution/session'

const INVALID_JSON = '{"title":"hi","count":"two"}'
const VALID_JSON = '{"title":"hi","count":2}'

function structuredPrompt() {
  return makePrompt({
    id: 'execution-structured',
    system: 'Return JSON.',
    prompt: ({ input }) => (input as { message: string }).message,
    input: z.object({ message: z.string() }),
    output: z.object({ title: z.string(), count: z.number() }),
  })
}

function adapterResponse(text: string): AdapterResponse {
  return {
    text,
    toolCalls: undefined,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
    responseId: undefined,
    actualModelId: undefined,
  }
}

function scriptedCoreStep(texts: readonly string[]) {
  const calls: Array<{ readonly messages: readonly Message[] }> = []
  const queue = [...texts]
  const client = { kind: 'core' as const }
  const dialect: AdapterExecutionDialect<
    typeof client,
    string,
    { readonly text: string },
    never,
    Record<string, unknown>
  > = {
    kind: 'core-step',
    id: 'mock-core',
    client,
    mapSettings: (settings) => ({ ...settings }),
    call: async (_client, args) => {
      calls.push({ messages: [...args.messages] })
      const text = queue.shift() ?? ''
      return { raw: { text }, extracted: adapterResponse(text) }
    },
    stream: async () => {
      throw new Error('not used')
    },
    appendToolRound: (messages, assistantResponse, toolResults) => [
      ...messages,
      { role: 'assistant' as const, content: assistantResponse.text },
      ...toolResults.map((result) => ({
        role: 'tool' as const,
        content: result.content,
        metadata: { toolCallId: result.toolCallId, toolName: result.name },
      })),
    ],
  }
  return { dialect, calls }
}

function scriptedSdkLoop(texts: readonly string[]) {
  const calls: Array<{ readonly messages: readonly Message[] | undefined }> = []
  const queue = [...texts]
  const client = { kind: 'sdk' as const }
  const dialect: AdapterExecutionDialect<typeof client, string, { readonly text: string }, never> = {
    kind: 'sdk-loop',
    id: 'mock-sdk',
    client,
    describeModel: (model): ModelInfo => ({ provider: 'mock-sdk', modelId: model }),
    mapSettings: (settings) => ({ ...settings }),
    runLoop: async () => {
      throw new Error('not used')
    },
    attemptStructured: async (_client, request) => {
      calls.push({ messages: request.messages })
      const text = queue.shift() ?? ''
      const validation = validateStructuredOutput(text, request.schema)
      if (!validation.valid) {
        return { status: 'invalid' as const, rawText: text, error: validation.error! }
      }
      const repaired = validation.repairedText ?? text
      return {
        status: 'ok' as const,
        raw: { text },
        response: adapterResponse(repaired),
        object: JSON.parse(repaired) as unknown,
      }
    },
    runStream: async () => {
      throw new Error('not used')
    },
  }
  return { dialect, calls }
}

describe('adapter execution session', () => {
  it('sends the same validation corrective exchange in core-step and sdk-loop dialects', async () => {
    const prompt = structuredPrompt()
    const core = scriptedCoreStep([INVALID_JSON, VALID_JSON])
    const sdk = scriptedSdkLoop([INVALID_JSON, VALID_JSON])

    await createAdapterExecution(core.dialect).generate({
      prompt,
      model: 'mock-model',
      modelInfo: { provider: 'mock-core', modelId: 'mock-model' },
      input: { message: 'make json' },
      validationRetry: { maxRetries: 2 },
    })

    await createAdapterExecution(sdk.dialect).generate({
      prompt,
      model: 'mock-model',
      input: { message: 'make json' },
      validationRetry: { maxRetries: 2 },
    })

    const lastCorrectiveUser = (messages: readonly Message[] | undefined) =>
      [...(messages ?? [])].reverse().find((message) => message.role === 'user' && message.content !== 'make json')
        ?.content
    const assistantEcho = (messages: readonly Message[] | undefined) =>
      [...(messages ?? [])].reverse().find((message) => message.role === 'assistant')?.content

    expect(lastCorrectiveUser(sdk.calls[1]?.messages)).toBe(lastCorrectiveUser(core.calls[1]?.messages))
    expect(lastCorrectiveUser(core.calls[1]?.messages)).toContain('Validation failed for your previous output')
    expect(assistantEcho(sdk.calls[1]?.messages)).toContain(INVALID_JSON)
    expect(assistantEcho(core.calls[1]?.messages)).toContain(INVALID_JSON)
  })

  it('adapts AdapterSpec hooks into a core-step dialect without changing their contract', async () => {
    const client = { apiKey: 'test-key' }
    const call = vi.fn(async (_client: typeof client, args: CallArgs<{ mode: string }>) => ({
      raw: { provider: 'raw', mode: args.extra.mode },
      extracted: adapterResponse('ok'),
    }))
    const stream = vi.fn(
      async (): Promise<StreamHandle<AsyncIterable<{ text: string }>>> => ({
        rawStream: (async function* () {
          yield { text: 'ok' }
        })(),
        extractTextDelta: (chunk) => (chunk as { text?: string }).text,
        completion: async () => ({ finishReason: 'stop' }),
      }),
    )
    const spec: AdapterSpec<
      typeof client,
      { readonly provider: string; readonly mode: string },
      AsyncIterable<{ text: string }>,
      { mode: string }
    > = {
      providerId: 'core-provider',
      call,
      stream,
      appendToolRound: (messages, response) => [...messages, { role: 'assistant' as const, content: response.text }],
      mapSettings: (settings) => ({ temperature: settings.temperature, mapped: true }),
      sanitizeToolSchema: (schema) => ({ ...schema, sanitized: true }),
      wrapOutputSchema: () => ({ wrapped: true }),
    }

    const dialect = coreStepDialect(spec, client)
    const result = await dialect.call(client, {
      model: 'm-1',
      system: undefined,
      systemBlocks: undefined,
      messages: [],
      settings: {},
      schema: undefined,
      schemaParams: undefined,
      tools: undefined,
      extra: { mode: 'fast' },
    })

    expect(dialect.kind).toBe('core-step')
    expect(dialect.id).toBe('core-provider')
    expect(dialect.client).toBe(client)
    expect(dialect.mapSettings({ temperature: 0.2 })).toEqual({ temperature: 0.2, mapped: true })
    expect(result.raw).toEqual({ provider: 'raw', mode: 'fast' })
    expect(dialect.sanitizeToolSchema?.({ type: 'object' })).toEqual({ type: 'object', sanitized: true })
    expect(dialect.wrapOutputSchema?.(z.object({ ok: z.boolean() }))).toEqual({ wrapped: true })
    expect(dialect.appendToolRound([], adapterResponse('assistant'), [])).toEqual([
      { role: 'assistant', content: 'assistant' },
    ])
  })

  it('adapts ExecutorSpec hooks into an sdk-loop dialect without changing their contract', async () => {
    const client = { gateway: 'fake' }
    const modelInfo: ModelInfo = { provider: 'sdk-provider', modelId: 'sdk-model' }
    const runLoop = vi.fn(async (_client: typeof client, request: ExecutorRequest<string>) => ({
      status: 'complete' as const,
      raw: { raw: request.model },
      response: adapterResponse('done'),
      messages: [{ role: 'assistant' as const, content: 'done' }],
      steps: 1,
      meta: { costUsd: 0.01 },
    }))
    const spec: ExecutorSpec<typeof client, string, { readonly raw: string }, { readonly stream: true }> = {
      executorId: 'sdk-executor',
      describeModel: (model) => ({ ...modelInfo, modelId: model }),
      mapSettings: (settings, info) => ({ ...settings, provider: info.provider }),
      runLoop,
      attemptStructured: async () => ({
        status: 'ok' as const,
        raw: { raw: 'structured' },
        response: adapterResponse('{"ok":true}'),
        object: { ok: true },
      }),
      runStream: async () => ({
        raw: { stream: true as const },
        completion: async () => ({ finishReason: 'stop', text: 'streamed' }),
      }),
      replayStream: () => ({
        raw: { stream: true as const },
        completion: async () => ({ finishReason: 'stop', text: 'cached' }),
      }),
    }

    const dialect = sdkLoopDialect(spec, client)
    const request: ExecutorRequest<string> = {
      model: 'sdk-model',
      modelInfo,
      system: undefined,
      systemBlocks: undefined,
      prompt: 'hello',
      messages: undefined,
      settings: {},
      tools: undefined,
      activeTools: undefined,
      maxSteps: 2,
      observer: undefined,
      abortSignal: undefined,
      extra: undefined,
    }

    const outcome = await dialect.runLoop(client, request)
    const streamHandle = await dialect.runStream(client, request)
    const replayed = await dialect.replayStream?.({ text: 'cached' }).completion()

    expect(dialect.kind).toBe('sdk-loop')
    expect(dialect.id).toBe('sdk-executor')
    expect(dialect.client).toBe(client)
    expect(dialect.describeModel('model-2')).toEqual({ provider: 'sdk-provider', modelId: 'model-2' })
    expect(dialect.mapSettings({ temperature: 0.5 }, modelInfo)).toEqual({
      temperature: 0.5,
      provider: 'sdk-provider',
    })
    expect(outcome.status).toBe('complete')
    expect(streamHandle.raw).toEqual({ stream: true })
    expect(replayed?.text).toBe('cached')
  })
})
