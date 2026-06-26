import { Agent as ConvexAgentBase } from '@convex-dev/agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent } from '../agent'

describe('Convex Agent facade', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves the Convex Agent constructor shape', () => {
    const component = {} as never
    const languageModel = {} as never

    const agent = new Agent(component, {
      name: 'Support Agent',
      languageModel,
      instructions: 'Help resolve support tickets.',
      tools: {},
    })

    expect(agent).toBeInstanceOf(ConvexAgentBase)
    expect(agent.options.name).toBe('Support Agent')
    expect(agent.options.languageModel).toBe(languageModel)
    expect(agent.options.instructions).toBe('Help resolve support tickets.')
  })

  it('forwards generation method arguments to Convex Agent unchanged', async () => {
    const ctx = { runMutation: vi.fn(), runQuery: vi.fn() }
    const target = { threadId: 'thread-1', userId: 'user-1' }
    const callArgs = { prompt: 'Summarize this thread.', custom: Symbol('custom') }
    const options = { contextOptions: { recentMessages: 3 } }
    const forwarded: Record<string, unknown[]> = {}

    vi.spyOn(ConvexAgentBase.prototype, 'generateText').mockImplementation(async function (...args: unknown[]) {
      forwarded.generateText = args
      return { text: 'ok' } as never
    } as never)
    vi.spyOn(ConvexAgentBase.prototype, 'streamText').mockImplementation(async function (...args: unknown[]) {
      forwarded.streamText = args
      return { textStream: [] } as never
    } as never)
    vi.spyOn(ConvexAgentBase.prototype, 'generateObject').mockImplementation(async function (...args: unknown[]) {
      forwarded.generateObject = args
      return { object: { ok: true } } as never
    } as never)
    vi.spyOn(ConvexAgentBase.prototype, 'streamObject').mockImplementation(async function (...args: unknown[]) {
      forwarded.streamObject = args
      return { partialObjectStream: [] } as never
    } as never)

    const agent = new Agent({} as never, {
      name: 'Support Agent',
      languageModel: {} as never,
      instructions: 'Help resolve support tickets.',
      tools: {},
    })

    await agent.generateText(ctx as never, target, callArgs as never, options)
    await agent.streamText(ctx as never, target, callArgs as never, options)
    await agent.generateObject(ctx as never, target, callArgs as never, options)
    await agent.streamObject(ctx as never, target, callArgs as never, options)

    expect(forwarded.generateText).toEqual([ctx, target, callArgs, options])
    expect(forwarded.streamText).toEqual([ctx, target, callArgs, options])
    expect(forwarded.generateObject).toEqual([ctx, target, callArgs, options])
    expect(forwarded.streamObject).toEqual([ctx, target, callArgs, options])
  })
})
