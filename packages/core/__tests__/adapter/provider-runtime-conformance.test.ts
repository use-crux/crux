import { describe, expect, it } from 'vitest'
import { providerRuntimeConformance, type ProviderRuntimeConformanceHarness } from '../../src/adapter/testing'
import {
  createRuntimeClient,
  createSingleTurnTestRuntime,
  runtimeResponse,
  type RuntimeClient,
  type RuntimeToolCall,
} from './provider-runtime-fixtures'

describe('providerRuntimeConformance', () => {
  it('validates a single-turn provider runtime through its public adapter boundary', async () => {
    const violations = await providerRuntimeConformance(createSingleTurnTestRuntime('conformance-single-turn'), {
      capabilities: {
        ownership: 'single-turn',
        structuredOutput: true,
        streaming: true,
        toolCalls: true,
      },
      prepare(script) {
        const client = createRuntimeClient({
          responses: script.structuredTexts
            ? script.structuredTexts.map((text) => runtimeResponse(text))
            : script.emissions?.map((emission) =>
                runtimeResponse(emission.text ?? '', {
                  ...(emission.usage === null
                    ? { usage: undefined }
                    : emission.usage !== undefined
                      ? { usage: emission.usage }
                      : {}),
                  toolCalls: emission.toolCalls?.map(
                    (toolCall, index): RuntimeToolCall => ({
                      id: toolCall.id ?? `call_${index}`,
                      name: toolCall.name,
                      args: toolCall.args,
                    }),
                  ),
                }),
              ),
          streamChunks: script.streamChunks ? [script.streamChunks] : undefined,
        })

        return {
          client,
          model: 'runtime-model',
          inspect: {
            calls: () => [...client.calls, ...client.streams],
            messagesForCall: (index) => client.calls[index]?.messages ?? client.streams[index]?.messages,
            bodyForCall: (index) => client.calls[index] ?? client.streams[index],
          },
        }
      },
    } satisfies ProviderRuntimeConformanceHarness<RuntimeClient>)

    expect(violations).toEqual([])
  })

    it('reports public runtime behavior that does not match the conformance script', async () => {
    const violations = await providerRuntimeConformance(createSingleTurnTestRuntime('conformance-violating'), {
      capabilities: {
        ownership: 'single-turn',
      },
      prepare() {
        const client = createRuntimeClient({
          responses: [runtimeResponse('wrong response')],
        })

        return {
          client,
          model: 'runtime-model',
          inspect: {
            calls: () => client.calls,
            messagesForCall: (index) => client.calls[index]?.messages,
            bodyForCall: (index) => client.calls[index],
          },
        }
      },
    } satisfies ProviderRuntimeConformanceHarness<RuntimeClient>)

    expect(violations).toContainEqual(
      expect.objectContaining({
        rule: 'text generation',
        detail: expect.stringContaining('expected "plain response"'),
      }),
    )
  })
})
