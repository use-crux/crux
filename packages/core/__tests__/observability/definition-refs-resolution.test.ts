import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { context } from '../../src/prompt/context'
import { prompt as makePrompt } from '../../src/prompt/prompt'
import { tool } from '../../src/tools/define-tool'
import { instrumentToolSet } from '../../src/adapter/tool/emission'
import type { CruxSpanStartRecord, DefinitionRef } from '../../src/observability/contract'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'

function spanStarts(records: readonly unknown[]): CruxSpanStartRecord[] {
  return records.filter(
    (record): record is CruxSpanStartRecord =>
      typeof record === 'object' &&
      record !== null &&
      (record as { type?: unknown }).type === 'span:start',
  )
}

function refsFor(records: readonly unknown[], primitive: string): DefinitionRef[][] {
  return spanStarts(records)
    .filter((record) => record.primitive === primitive)
    .map((record) => record.definitionRefs ?? [])
}

type Instrumented = { execute: (input: unknown, options?: { toolCallId?: string }) => Promise<unknown> }

describe('prompt/context/tool DefinitionRef emission', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('carries one prompt, one context, and two tool refs across the real spans of a single agent step', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const usedContext = context({ id: 'my-context', system: 'Ctx.' })
    const p = makePrompt({
      id: 'my-prompt',
      input: z.object({ topic: z.string() }),
      use: [usedContext] as const,
      system: 'Base.',
    })
    const tools = instrumentToolSet({
      search: tool({
        name: 'search',
        description: 'search',
        input: z.object({}),
        execute: async () => 'r',
      }),
      lookup: tool({
        name: 'lookup',
        description: 'lookup',
        input: z.object({}),
        execute: async () => 'r',
      }),
    }) as Record<string, Instrumented>

    // One agent step: resolve the prompt (with its context) and invoke two tools.
    await observe.run({ name: 'agent step', rootPrimitive: 'agent.run' }, async () => {
      await p.resolve({ input: { topic: 'observability' } })
      await tools.search.execute({}, { toolCallId: 'tc-1' })
      await tools.lookup.execute({}, { toolCallId: 'tc-2' })
    })
    await observe.flush()

    expect(refsFor(transport.records, 'prompt.resolve')).toEqual([
      [{ id: 'prompt:my-prompt', kind: 'prompt', role: 'resolved-prompt' }],
    ])
    expect(refsFor(transport.records, 'context.resolve')).toEqual([
      [{ id: 'context:my-context', kind: 'context', role: 'resolved-context' }],
    ])
    expect(refsFor(transport.records, 'tool.call').sort((a, b) => a[0].id.localeCompare(b[0].id))).toEqual([
      [{ id: 'tool:lookup', kind: 'tool', role: 'invoked-tool' }],
      [{ id: 'tool:search', kind: 'tool', role: 'invoked-tool' }],
    ])
  })

  it('emits no ref when a compiled definition has no authored identity in scope', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    // Anonymous prompt/context: the indexer would fall back to the local
    // variable name, which the runtime cannot observe — so no ref, never a guess.
    const anonContext = context({ system: 'Ctx.' })
    const anonPrompt = makePrompt({
      input: z.object({ topic: z.string() }),
      use: [anonContext] as const,
      system: 'Base.',
    })
    const tools = instrumentToolSet({
      // No authored `name`/`title`: the map key is the model-facing name, not the
      // canonical authored identity, so no ref is emitted.
      anon: tool({ description: 'anon', input: z.object({}), execute: async () => 'r' }),
    }) as Record<string, Instrumented>

    await observe.run({ name: 'agent step', rootPrimitive: 'agent.run' }, async () => {
      await anonPrompt.resolve({ input: { topic: 'observability' } })
      await tools.anon.execute({}, { toolCallId: 'tc-1' })
    })
    await observe.flush()

    expect(refsFor(transport.records, 'prompt.resolve')).toEqual([[]])
    expect(refsFor(transport.records, 'context.resolve')).toEqual([[]])
    expect(refsFor(transport.records, 'tool.call')).toEqual([[]])
  })
})
