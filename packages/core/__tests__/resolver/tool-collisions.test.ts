import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { compilePrompt } from '../../resolver/compile'
import { context, prompt as makePrompt } from '../../prompt'
import { contributor } from '../../prompt/contributor'
import { contextWithFamily } from '../../prompt/context'
import type { AnyPromptConfig } from '../../prompt/prompt-types'
import type { BlackboardEntry, SkillEntry } from '../../prompt/context-types'
import type { AnyToolSet } from '../../types'
import { LOAD_SKILL_TOOL_NAME } from '../../skill/tools'
import { adapter as makeAdapter } from '../../adapter/define-adapter'
import type { AdapterSpec } from '../../adapter/spec'
import type { AdapterResponse, CallArgs, StreamHandle, ToolResultEntry } from '../../adapter/types'
import type { Message } from '../../generation/messages'

function tool(description: string): { description: string; parameters: z.ZodObject; execute: () => string } {
  return { description, parameters: z.object({}), execute: () => description }
}

function fakeBlackboard(id: string, tools: AnyToolSet): BlackboardEntry {
  return {
    _tag: 'Blackboard',
    id,
    asContext: () => contextWithFamily({ id: `blackboard:${id}`, system: `Board ${id}.` }, 'blackboard'),
    asTools: () => tools,
  }
}

function fakeSkill(id: string): SkillEntry {
  return {
    _tag: 'Skill',
    id,
    description: `Skill ${id}`,
    instructions: `Do ${id}.`,
    references: [],
    meta: { name: id, description: `Skill ${id}` },
    dump: () => `Do ${id}.`,
  }
}

describe('resolver tool collision policy', () => {
  it('context×context collisions throw with both owners', async () => {
    const first = context({
      id: 'search-a',
      system: 'Search A.',
      tools: { search: tool('Search A') },
    })
    const second = context({
      id: 'search-b',
      system: 'Search B.',
      tools: { search: tool('Search B') },
    })

    const config = {
      system: 'Use search.',
      use: [first, second],
    } satisfies AnyPromptConfig

    await expect(compilePrompt(config).resolve()).rejects.toThrow(
      'Tool name collision for "search": contributed by both context:search-a and context:search-b. ' +
        'Rename one of them, or pass the overriding tool at the call site (call-site tools intentionally win).',
    )
  })

  it('context×injected collisions throw with contributor owner labels', async () => {
    const ctx = context({
      id: 'context-search',
      system: 'Search context.',
      tools: { search: tool('Context search') },
    })
    const injection = contributor({
      id: 'legacy-search',
      contribute: () => ({
        tools: { search: tool('Injected search') },
      }),
    })

    const config = {
      system: 'Use search.',
      use: [ctx, injection],
    } satisfies AnyPromptConfig

    await expect(compilePrompt(config).resolve()).rejects.toThrow(
      'Tool name collision for "search": contributed by both context:context-search and contributor:legacy-search. ' +
        'Rename one of them, or pass the overriding tool at the call site (call-site tools intentionally win).',
    )
  })

  it('injected×blackboard collisions throw with both owners', async () => {
    const injection = contributor({
      id: 'planner',
      contribute: () => ({
        tools: { write_plan: tool('Injected planner') },
      }),
    })
    const board = fakeBlackboard('plan', { write_plan: tool('Board planner') })

    const config = {
      system: 'Plan.',
      use: [injection, board],
    } satisfies AnyPromptConfig

    await expect(compilePrompt(config).resolve()).rejects.toThrow(
      'Tool name collision for "write_plan": contributed by both contributor:planner and blackboard:plan. ' +
        'Rename one of them, or pass the overriding tool at the call site (call-site tools intentionally win).',
    )
  })

  it('blackboard×config collisions throw with both owners', async () => {
    const board = fakeBlackboard('plan', { write_plan: tool('Board planner') })

    const config = {
      system: 'Plan.',
      use: [board],
      tools: { write_plan: tool('Configured planner') },
    } satisfies AnyPromptConfig

    await expect(compilePrompt(config).resolve()).rejects.toThrow(
      'Tool name collision for "write_plan": contributed by both blackboard:plan and prompt config. ' +
        'Rename one of them, or pass the overriding tool at the call site (call-site tools intentionally win).',
    )
  })

  it('skill×context collisions throw with both owners', async () => {
    const loaderCollision = context({
      id: 'loader-collision',
      system: 'Loader context.',
      tools: { [LOAD_SKILL_TOOL_NAME]: tool('Context loader') },
    })

    const config = {
      system: 'Use skills.',
      use: [fakeSkill('seo'), loaderCollision],
    } satisfies AnyPromptConfig

    await expect(compilePrompt(config).resolve()).rejects.toThrow(
      `Tool name collision for "${LOAD_SKILL_TOOL_NAME}": contributed by both skill:seo and context:loader-collision. ` +
        'Rename one of them, or pass the overriding tool at the call site (call-site tools intentionally win).',
    )
  })

  it('config×context collisions throw with both owners', async () => {
    const ctx = context({
      id: 'lookup-context',
      system: 'Lookup context.',
      tools: { lookup: tool('Context lookup') },
    })

    const config = {
      system: 'Lookup.',
      use: [ctx],
      tools: { lookup: tool('Configured lookup') },
    } satisfies AnyPromptConfig

    await expect(compilePrompt(config).resolve()).rejects.toThrow(
      'Tool name collision for "lookup": contributed by both context:lookup-context and prompt config. ' +
        'Rename one of them, or pass the overriding tool at the call site (call-site tools intentionally win).',
    )
  })

  it('collision error names both owners', async () => {
    const first = context({
      id: 'alpha',
      system: 'Alpha.',
      tools: { shared: tool('Alpha tool') },
    })
    const second = context({
      id: 'beta',
      system: 'Beta.',
      tools: { shared: tool('Beta tool') },
    })

    await expect(
      compilePrompt({ system: 'Use tools.', use: [first, second] } satisfies AnyPromptConfig).resolve(),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Tool name collision for "shared": contributed by both context:alpha and context:beta. Rename one of them, or pass the overriding tool at the call site (call-site tools intentionally win).]`,
    )
  })

  it('call-site tools override without error', async () => {
    const calls: CallArgs[] = []
    const spec: AdapterSpec<Record<string, never>, { id: string }, AsyncIterable<unknown>> = {
      providerId: 'test',
      async call(_client, args) {
        calls.push(args)
        return { raw: { id: 'raw' }, extracted: response('done', args.model) }
      },
      async stream(): Promise<StreamHandle<AsyncIterable<unknown>>> {
        return {
          rawStream: emptyStream(),
          extractTextDelta: () => undefined,
          completion: async () => undefined,
        }
      },
      appendToolRound(messages: Message[], _assistantResponse: AdapterResponse, _toolResults: ToolResultEntry[]) {
        return messages
      },
      mapSettings: (settings) => settings,
    }
    const adapter = makeAdapter(spec)({})
    const assistant = makePrompt({
      id: 'call-site-tool-override',
      system: 'Use tools.',
      prompt: 'Call search.',
      tools: { search: tool('Prompt search') },
    })

    await expect(
      adapter.generate(assistant, {
        model: 'test-model',
        tools: { search: tool('Call-site search') },
      }),
    ).resolves.toMatchObject({ text: 'done' })

    expect(calls[0]?.tools?.find((entry) => entry.name === 'search')?.description).toBe('Call-site search')
  })
})

function response(text: string, model: string): AdapterResponse {
  return {
    text,
    toolCalls: undefined,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: {}, outputTokenDetails: {} },
    finishReason: 'stop',
    responseId: 'resp',
    actualModelId: model,
  }
}

async function* emptyStream(): AsyncIterable<unknown> {}
