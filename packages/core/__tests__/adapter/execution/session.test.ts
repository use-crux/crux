import { describe, expect, it, vi } from 'vitest'
import { z, ZodError } from 'zod'
import { prompt as makePrompt } from '../../../src/prompt/prompt'
import type { Message } from '../../../src/generation/messages'
import type { ModelInfo } from '../../../src/types'
import { permissiveCapabilities } from '../structured-output/capability-fixtures'
import type { AdapterResponse, CallArgs, StreamHandle } from '../../../src/adapter/types'
import type { AdapterSpec } from '../../../src/adapter/spec'
import type { LoopRuntimePort } from '../../../src/adapter/loop-runtime-port'
import type { ExecutorRequest } from '../../../src/adapter/executor-types'
import type { AdapterExecutionDialect } from '../../../src/adapter/execution/session'
import { coreStepDialect, createAdapterExecution, sdkLoopDialect } from '../../../src/adapter/execution/session'

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
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: {}, outputTokenDetails: {} },
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
    structuredOutput: { accepts: permissiveCapabilities },
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
  const dialect: AdapterExecutionDialect<unknown, string, { readonly text: string }, never> = {
    kind: 'sdk-loop',
    id: 'mock-sdk',
    structuredOutput: { capabilities: () => permissiveCapabilities },
    describeModel: (model): ModelInfo => ({ provider: 'mock-sdk', modelId: model }),
    mapSettings: (settings) => ({ ...settings }),
    runTextLoop: async () => {
      throw new Error('not used')
    },
    runStructuredAttempt: async (request) => {
      calls.push({ messages: request.messages })
      const text = queue.shift() ?? ''
      // A real SDK validates the wire value structurally, not the authored Zod
      // schema; core owns the authored parse.
      let wireValue: unknown
      try {
        wireValue = JSON.parse(text) as unknown
      } catch {
        return {
          status: 'invalid' as const,
          rawText: text,
          error: new ZodError([{ code: 'custom', path: [], message: 'Invalid JSON' }]),
        }
      }
      return {
        status: 'ok' as const,
        raw: { text },
        response: adapterResponse(text),
        wireValue,
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
      structuredOutput: { accepts: permissiveCapabilities },
    }

    const dialect = coreStepDialect(spec, client)
    const result = await dialect.call(client, {
      model: 'm-1',
      system: undefined,
      systemBlocks: undefined,
      messages: [],
      settings: {},
      schema: undefined,
      outputSchema: undefined,
      tools: undefined,
      extra: { mode: 'fast' },
    })

    expect(dialect.kind).toBe('core-step')
    expect(dialect.id).toBe('core-provider')
    expect(dialect.client).toBe(client)
    expect(dialect.mapSettings({ temperature: 0.2 })).toEqual({ temperature: 0.2, mapped: true })
    expect(result.raw).toEqual({ provider: 'raw', mode: 'fast' })
    expect(dialect.sanitizeToolSchema?.({ type: 'object' })).toEqual({ type: 'object', sanitized: true })
    expect(dialect.structuredOutput?.accepts).toBe(permissiveCapabilities)
    expect(dialect.appendToolRound([], adapterResponse('assistant'), [])).toEqual([
      { role: 'assistant', content: 'assistant' },
    ])
  })

    it('tags a LoopRuntimePort as an sdk-loop dialect without changing its contract', async () => {
    const modelInfo: ModelInfo = { provider: 'sdk-provider', modelId: 'sdk-model' }
    const runTextLoop = vi.fn(async (request: ExecutorRequest<string>) => ({
      status: 'complete' as const,
      raw: { raw: request.model },
      response: adapterResponse('done'),
      messages: [{ role: 'assistant' as const, content: 'done' }],
      steps: 1,
      meta: { costUsd: 0.01 },
    }))
    const port: LoopRuntimePort<string, { readonly raw: string }, { readonly stream: true }> = {
      id: 'sdk-executor',
      describeModel: (model) => ({ ...modelInfo, modelId: model }),
      mapSettings: (settings, info) => ({ ...settings, provider: info.provider }),
      runTextLoop,
      runStructuredAttempt: async () => ({
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

    const dialect = sdkLoopDialect(port)
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

    const outcome = await dialect.runTextLoop(request)
    const streamHandle = await dialect.runStream(request)
    const replayed = await dialect.replayStream?.({ text: 'cached' }).completion()

    expect(dialect.kind).toBe('sdk-loop')
    expect(dialect.id).toBe('sdk-executor')
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
