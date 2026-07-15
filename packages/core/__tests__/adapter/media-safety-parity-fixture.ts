import { vi } from 'vitest'
import { coreStepDialect, createAdapterExecution, sdkLoopDialect } from '../../src/adapter/execution/session'
import { fakeLoopRuntime } from '../../src/adapter/testing'
import type { AdapterSpec } from '../../src/adapter/spec'
import type { AdapterResponse, StreamCompletionMetadata, StreamHandle } from '../../src/adapter/types'
import type { ExecutorStreamMeta } from '../../src/adapter/executor-types'
import type { LoopRuntimePort } from '../../src/adapter/loop-runtime-port'
import type { Message } from '../../src/generation/messages'
import { prompt } from '../../src/prompt/prompt'
import { boundary, guardrail, type GuardrailAudit, type MediaPartSubject } from '../../src/safety'

export type MediaExecutionPath = 'generate-core' | 'generate-sdk' | 'stream-core' | 'stream-sdk'
export type MediaScenario = 'allow' | 'strip' | 'report-strip' | 'block' | 'invalid'

export interface MediaPathResult {
  readonly path: MediaExecutionPath
  readonly callbackCount: number
  readonly callbackSawRawSource: boolean
  readonly providerMessages: readonly (readonly Message[])[]
  readonly resultMessages: readonly Message[] | undefined
  readonly audit: GuardrailAudit | undefined
  readonly error: unknown
  readonly events: readonly string[]
  readonly normalizationReads: number
}

const TEST_RESPONSE: AdapterResponse = {
  text: 'ok',
  toolCalls: undefined,
  usage: undefined,
  finishReason: 'stop',
  responseId: undefined,
  actualModelId: undefined,
}

/** Run one media action through one concrete adapter execution path. */
export async function runMediaPath(path: MediaExecutionPath, scenario: MediaScenario): Promise<MediaPathResult> {
  const events: string[] = []
  const source = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
  const readSource = source.arrayBuffer.bind(source)
  const read = vi.spyOn(source, 'arrayBuffer').mockImplementation(async () => {
    events.push('normalize')
    return readSource()
  })
  let callbackCount = 0
  let callbackSawRawSource = false
  const policy = guardrail({
    id: `media-${scenario}`,
    on: boundary.input.media(),
    ...(scenario === 'report-strip' ? { mode: 'report' as const } : {}),
    run: ((subject: MediaPartSubject) => {
      events.push('guard')
      callbackCount++
      callbackSawRawSource = subject.part.source === source
      switch (scenario) {
        case 'allow':
          return { action: 'allow' }
        case 'strip':
        case 'report-strip':
          return { action: 'strip', reason: 'Remove media.' }
        case 'block':
          return { action: 'block', reason: 'Block media.' }
        case 'invalid':
          return { action: 'rewrite', value: 'invalid' }
      }
    }) as never,
  })
  const messages: Message[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Inspect this.' },
        { type: 'image', source, mediaType: 'image/png' },
      ],
    },
  ]
  const providerMessages: Array<readonly Message[]> = []
  let resultMessages: readonly Message[] | undefined
  let audit: GuardrailAudit | undefined
  let error: unknown

  try {
    if (path.endsWith('core')) {
      const execution = createAdapterExecution(
        coreStepDialect(coreFixture(providerMessages, events), { kind: 'core' as const }),
      )
      if (path === 'generate-core') {
        const result = await execution.generate({
          prompt: testPrompt(),
          model: 'mock-model',
          modelInfo: { provider: 'mock-core', modelId: 'mock-model' },
          messages,
          guardrails: [policy],
        })
        resultMessages = result.messages
        audit = result._meta.guardrails
      } else {
        const handle = await execution.stream({
          prompt: testPrompt(),
          model: 'mock-model',
          modelInfo: { provider: 'mock-core', modelId: 'mock-model' },
          messages,
          guardrails: [policy],
        })
        if (!('rawStream' in handle)) throw new TypeError('Expected a core stream handle.')
        for await (const _chunk of handle.rawStream) {
          // Draining lets the core stream wrapper finalize its safety protocol.
        }
        const meta = await handle.completion()
        resultMessages = meta?.messages
        audit = meta?.guardrails
      }
    } else {
      const execution = createAdapterExecution(sdkLoopDialect(sdkFixture(providerMessages, events)))
      if (path === 'generate-sdk') {
        const result = await execution.generate({
          prompt: testPrompt(),
          model: 'mock:mock-model',
          messages,
          guardrails: [policy],
        })
        resultMessages = result.messages
        audit = result._meta.guardrails
      } else {
        const handle = await execution.stream({
          prompt: testPrompt(),
          model: 'mock:mock-model',
          messages,
          guardrails: [policy],
        })
        const meta = await handle.completion()
        resultMessages = meta?.messages
        audit = meta?.guardrails
      }
    }
  } catch (caught: unknown) {
    error = caught
  }

  return {
    path,
    callbackCount,
    callbackSawRawSource,
    providerMessages,
    resultMessages,
    audit,
    error,
    events,
    normalizationReads: read.mock.calls.length,
  }
}

function testPrompt() {
  return prompt({ id: 'media-parity', prompt: 'Inspect media.' })
}

function coreFixture(providerMessages: Array<readonly Message[]>, events: string[]) {
  const spec: AdapterSpec<
    { readonly kind: 'core' },
    { readonly kind: 'core-response' },
    AsyncIterable<{ readonly text: string }>
  > = {
    providerId: 'mock-core',
    async call(_client, args) {
      events.push('provider')
      providerMessages.push(args.messages)
      return { raw: { kind: 'core-response' }, extracted: TEST_RESPONSE }
    },
    async stream(_client, args): Promise<StreamHandle<AsyncIterable<{ readonly text: string }>>> {
      events.push('provider')
      providerMessages.push(args.messages)
      const rawStream = (async function* () {
        yield { text: 'ok' }
      })()
      return {
        rawStream,
        extractTextDelta: (chunk) => (chunk as { readonly text?: string }).text,
        completion: async (): Promise<StreamCompletionMetadata> => ({ text: 'ok', finishReason: 'stop' }),
      }
    },
    appendToolRound: (messages) => messages,
    mapSettings: (settings) => ({ ...settings }),
  }
  return spec
}

function sdkFixture(providerMessages: Array<readonly Message[]>, events: string[]): LoopRuntimePort<
  string,
  { readonly kind: 'fake-loop' | 'fake-structured'; readonly text: string; readonly object?: unknown; readonly system?: string },
  { readonly kind: 'fake-stream'; readonly chunks: readonly string[]; readonly text: string }
> {
  const fake = fakeLoopRuntime({ loops: [[{ text: 'ok' }]], streams: [['ok']] })
  return {
    ...fake.runtime,
    async runTextLoop(request) {
      events.push('provider')
      providerMessages.push(request.messages ?? [])
      return fake.runtime.runTextLoop(request)
    },
    async runStream(request) {
      events.push('provider')
      providerMessages.push(request.messages ?? [])
      const handle = await fake.runtime.runStream(request)
      return {
        ...handle,
        completion: async (): Promise<ExecutorStreamMeta | undefined> => {
          const meta = await handle.completion()
          return meta
            ? {
                ...meta,
                messages: [
                  ...(request.messages ?? []),
                  { role: 'assistant' as const, content: meta.text ?? '' },
                ],
              }
            : undefined
        },
      }
    },
  }
}
