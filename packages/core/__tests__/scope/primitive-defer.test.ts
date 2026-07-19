import { afterEach, describe, expect, it } from 'vitest'
import { createParallel, type AgentExecutor } from '../../src/agent'
import { adapter } from '../../src/adapter/define-adapter'
import type { AdapterResponse } from '../../src/adapter/types'
import { createToolLifecycle } from '../../src/adapter/tool/session'
import { defer } from '../../src/defer'
import { flow } from '../../src/flow'
import { currentScope } from '../../src/scope/internal'
import { prompt } from '../../src/prompt/prompt'
import type { ResolvedPrompt } from '../../src/resolver/types'
import { boundary, createSafety } from '../../src/safety'
import { guardrail } from '../../src/safety/guardrail'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'

const unusedExecutor: AgentExecutor = async () => {
  throw new Error('Plain function members do not call the agent executor.')
}

afterEach(() => {
  resetObservabilityRuntime()
})

describe('Crux primitive defer scopes', () => {
  it('drains defer() at an agent member boundary without a wrapper or host config', async () => {
    const drained = deferred<void>()
    const seen: Array<{ readonly kind: string; readonly name?: string }> = []
    const parallel = createParallel(unusedExecutor)

    await parallel({
      id: 'level-zero-agent',
      context: {},
      agents: {
        researcher: async () => {
          defer(() => {
            const descriptor = currentScope()?.descriptor
            if (descriptor) seen.push(descriptor)
            drained.resolve()
          })
          return 'done'
        },
      },
    })
    await drained.promise

    expect(seen).toEqual([
      expect.objectContaining({ kind: 'agent-turn', name: 'researcher' }),
    ])
  })

  it('drains defer() at a direct tool execution boundary', async () => {
    const drained = deferred<void>()
    let registeringScopeId: string | undefined
    let callbackScopeId: string | undefined
    const lifecycle = createToolLifecycle({
      regime: 'core',
      resolved: resolvedWith({
        tools: {
          lookup: {
            execute: async () => {
              registeringScopeId = currentScope()?.descriptor.id
              defer(() => {
                callbackScopeId = currentScope()?.descriptor.id
                drained.resolve()
              })
              return 'found'
            },
          },
        },
      }),
      promptId: 'tool-boundary',
    })

    await lifecycle.executeRound(
      adapterResponse({
        toolCalls: [{ id: 'tc-1', name: 'lookup', args: {} }],
      }),
      [{ role: 'user', content: 'look it up' }],
    )
    await drained.promise

    expect(currentScope()).toBeUndefined()
    expect(callbackScopeId).toBe(registeringScopeId)
  })

  it('drains defer() from an SDK-driven tool execution boundary', async () => {
    const drained = deferred<void>()
    let registeringScopeId: string | undefined
    let callbackScopeId: string | undefined
    const lifecycle = createToolLifecycle({
      regime: 'sdk',
      resolved: resolvedWith({
        tools: {
          lookup: {
            execute: async () => {
              registeringScopeId = currentScope()?.descriptor.id
              defer(() => {
                callbackScopeId = currentScope()?.descriptor.id
                drained.resolve()
              })
              return 'found'
            },
          },
        },
      }),
      promptId: 'sdk-tool-boundary',
    })
    const lookup = lifecycle.tools?.lookup as {
      readonly execute: (
        input: unknown,
        options: { readonly toolCallId: string },
      ) => Promise<unknown>
    }

    await lookup.execute({}, { toolCallId: 'tc-sdk-1' })
    await drained.promise

    expect(registeringScopeId).toMatch(/^tool:/)
    expect(callbackScopeId).toBe(registeringScopeId)
  })

  it('attributes adapter defer evidence to the registering adapter-call scope', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const drained = deferred<void>()
    const fixture = adapter({
      providerId: 'scope-fixture',
      mapSettings: () => ({}),
      appendToolRound: (messages) => messages,
      async call() {
        defer(() => drained.resolve())
        return {
          raw: { ok: true },
          extracted: adapterResponse({ text: 'done', finishReason: 'stop' }),
        }
      },
      async stream() {
        throw new Error('not used')
      },
    })({})

    await fixture.generate(prompt({ id: 'adapter-evidence', prompt: 'go' }), {
      model: 'fixture-model',
    })
    await drained.promise
    await observe.flush()

    const scheduled = transport.records.find(
      (record) =>
        record.type === 'span:start' && record.primitive === 'defer.scheduled',
    )
    expect(scheduled).toMatchObject({
      attributes: expect.objectContaining({
        scopeKind: 'adapter-call',
        scopeName: 'adapter-evidence',
      }),
    })
  })

  it('restores one adapter scope across raw-stream pulls and completion', async () => {
    const drained = deferred<void>()
    const segmentScopes: string[] = []
    const fixture = adapter({
      providerId: 'stream-scope-fixture',
      mapSettings: () => ({}),
      appendToolRound: (messages) => messages,
      async call() {
        throw new Error('not used')
      },
      async stream() {
        return {
          rawStream: (async function* () {
            segmentScopes.push(currentScope()?.descriptor.id ?? 'missing')
            defer(() => drained.resolve())
            yield { text: 'hello' }
          })(),
          extractTextDelta: (chunk: unknown) =>
            (chunk as { readonly text: string }).text,
          completion: async () => {
            segmentScopes.push(currentScope()?.descriptor.id ?? 'missing')
            return { text: 'hello', finishReason: 'stop' }
          },
        }
      },
    })({})

    const result = await fixture.stream(
      prompt({ id: 'stream-boundary', prompt: 'stream' }),
      { model: 'fixture-model' },
    )
    const chunks: string[] = []
    for await (const chunk of result.textStream) chunks.push(chunk)
    await result.completion
    await drained.promise

    expect(chunks).toEqual(['hello'])
    expect(segmentScopes).toHaveLength(2)
    expect(new Set(segmentScopes).size).toBe(1)
    expect(segmentScopes[0]).toMatch(/^adapter-call:/)
  })

  it('starts a tool drain before the enclosing adapter call finishes', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const drainStarted = deferred<void>()
    const releaseDrain = deferred<void>()
    let providerCalls = 0
    const fixture = adapter({
      providerId: 'timing-fixture',
      mapSettings: () => ({}),
      appendToolRound: (messages, _response, results) => [
        ...messages,
        ...results.map((result) => ({
          role: 'tool' as const,
          content: result.content,
        })),
      ],
      async call() {
        providerCalls += 1
        if (providerCalls === 1) {
          return {
            raw: { step: 1 },
            extracted: adapterResponse({
              toolCalls: [{ id: 'tc-1', name: 'slow', args: {} }],
            }),
          }
        }
        await drainStarted.promise
        return {
          raw: { step: 2 },
          extracted: adapterResponse({
            text: 'finished',
            finishReason: 'stop',
          }),
        }
      },
      async stream() {
        throw new Error('not used')
      },
    })({})
    const generation = fixture.generate(
      prompt({
        id: 'nearest-scope-timing',
        tools: {
          slow: {
            execute: async () => {
              defer(async () => {
                drainStarted.resolve()
                await releaseDrain.promise
              })
              return 'tool result'
            },
          },
        },
        prompt: 'go',
      }),
      { model: 'fixture-model', maxSteps: 2 },
    )

    await drainStarted.promise
    await expect(Promise.race([generation, timeout(1_000)])).resolves.not.toBe(
      'timed-out',
    )
    releaseDrain.resolve()
    await generation
    await observe.flush()

    const scheduled = transport.records.find(
      (record) =>
        record.type === 'span:start' &&
        record.primitive === 'defer.scheduled' &&
        record.attributes.scopeKind === 'tool',
    )
    expect(scheduled).toMatchObject({
      attributes: expect.objectContaining({
        scopeKind: 'tool',
        scopeName: 'slow',
      }),
    })
  })

  it('restores one safety-session scope across segmented policy execution', async () => {
    const drained = deferred<void>()
    let registrationScope: string | undefined
    let callbackScope: string | undefined
    const safety = createSafety({
      promptId: 'safe-answer',
      model: 'fixture-model',
      call: {
        guardrails: [
          guardrail({
            id: 'scope-aware-input',
            on: boundary.input.text(),
            run: async () => {
              registrationScope = currentScope()?.descriptor.id
              defer(() => {
                callbackScope = currentScope()?.descriptor.id
                drained.resolve()
              })
              return { action: 'allow' as const }
            },
          }),
        ],
      },
    })

    await safety.guardInput({
      messages: [{ role: 'user', content: 'hello' }],
    })
    await safety.finalizeOutput({ text: 'safe' }, async () => ({
      text: 'safe',
    }))
    await drained.promise

    expect(registrationScope).toMatch(/^safety-session:/)
    expect(callbackScope).toBe(registrationScope)
  })

  it('opens a flow-step scope without weakening replay safety', async () => {
    let descriptor:
      | NonNullable<ReturnType<typeof currentScope>>['descriptor']
      | undefined
    const workflow = flow('scope-aware-flow', async (scope) =>
      scope.step('research', () => {
        descriptor = currentScope()?.descriptor
        return 'done'
      }),
    )

    await expect(workflow.run()).resolves.toMatchObject({
      status: 'completed',
      output: 'done',
    })
    expect(descriptor).toMatchObject({
      kind: 'flow-step',
      name: 'research',
      sourceRef: expect.objectContaining({ file: expect.any(String) }),
    })
  })
})

function resolvedWith(partial: Partial<ResolvedPrompt>): ResolvedPrompt {
  return { settings: {}, ...partial } as ResolvedPrompt
}

function adapterResponse(partial: Partial<AdapterResponse>): AdapterResponse {
  return {
    text: '',
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      inputTokenDetails: {},
      outputTokenDetails: {},
    },
    finishReason: 'tool_calls',
    ...partial,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function timeout(ms: number): Promise<'timed-out'> {
  return new Promise((resolve) => {
    setTimeout(() => resolve('timed-out'), ms)
  })
}
