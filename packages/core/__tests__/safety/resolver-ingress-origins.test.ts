/** Provider-visible behavior for resolver-owned model-ingress origins. */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { blackboard, handoff } from '../../src/agent'
import { adapter } from '../../src/adapter/define-adapter'
import type { CallArgs } from '../../src/adapter/types'
import { memory, memoryBlock } from '../../src/memory'
import { context } from '../../src/prompt/context'
import { contributor } from '../../src/prompt/contributor'
import { prompt } from '../../src/prompt/prompt'
import { boundary, guardrail } from '../../src/safety'
import { classifySystemIngressBlock } from '../../src/safety/input/system-ingress-classification'
import { capturingRetrievalAdapter } from '../adapter/retrieval-input-safety.fixture'

describe('resolver model-ingress origins', () => {
  it('guards first-party memory context with safe memory provenance', async () => {
    const calls: CallArgs[] = []
    const notes = memory({
      id: 'notes',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'summary',
          kind: 'custom',
          render: () => 'private recalled memory',
        }),
      ],
    })
    const answer = prompt({
      system: 'Trusted instructions.',
      use: [notes],
      prompt: 'Answer.',
    })

    await adapter(capturingRetrievalAdapter(calls))({}).generate(answer, {
      model: 'test-model',
      guardrails: [
        guardrail({
          id: 'rewrite-memory-ingress',
          on: boundary.input.text({ from: 'memory' }),
          run: (text, context) => {
            expect(context.origin).toEqual({
              source: 'memory',
              kind: 'memory-context',
              memoryId: 'notes',
              blockIndex: 1,
            })
            return {
              action: 'rewrite',
              value: text.replace('private', 'safe'),
              rewrite: { kind: 'redact' },
            }
          },
        }),
      ],
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.system).toBe(
      'Trusted instructions.\n\n## Memory: summary\nsafe recalled memory',
    )
  })

  it('guards first-party blackboard context as memory ingress', async () => {
    const calls: CallArgs[] = []
    const board = blackboard({
      id: 'plan',
      schema: z.object({ note: z.string().optional() }),
    })
    await board.set('note', 'private shared state')
    const answer = prompt({
      use: [board.asContext()],
      prompt: 'Answer.',
    })

    await adapter(capturingRetrievalAdapter(calls))({}).generate(answer, {
      model: 'test-model',
      guardrails: [
        guardrail({
          id: 'rewrite-blackboard-ingress',
          on: boundary.input.text({ from: 'memory' }),
          run: (text, context) => {
            expect(context.origin).toEqual({
              source: 'memory',
              kind: 'blackboard-context',
              boardId: 'plan',
              blockIndex: 0,
            })
            return {
              action: 'rewrite',
              value: text.replace('private', 'safe'),
              rewrite: { kind: 'redact' },
            }
          },
        }),
      ],
    })

    expect(calls[0]?.system).toContain('safe shared state')
    expect(calls[0]?.system).not.toContain('private shared state')
  })

  it('guards first-party handoff context with safe handoff provenance', async () => {
    const calls: CallArgs[] = []
    const transfer = handoff({
      id: 'research-to-writer',
      inputSchema: z.object({ notes: z.string() }),
      outputSchema: z.object({ notes: z.string() }),
      transform: (input) => input,
    })
    const payload = await transfer.prepare({ notes: 'private findings' })
    const answer = prompt({
      use: [transfer.asContext(payload)],
      prompt: 'Draft.',
    })

    await adapter(capturingRetrievalAdapter(calls))({}).generate(answer, {
      model: 'test-model',
      guardrails: [
        guardrail({
          id: 'rewrite-handoff-ingress',
          on: boundary.input.text({ from: 'handoff' }),
          run: (text, context) => {
            expect(context.origin).toEqual({
              source: 'handoff',
              kind: 'handoff-context',
              handoffId: 'research-to-writer',
              blockIndex: 0,
            })
            return {
              action: 'rewrite',
              value: text.replace('private', 'safe'),
              rewrite: { kind: 'redact' },
            }
          },
        }),
      ],
    })

    expect(calls[0]?.system).toContain('safe findings')
    expect(calls[0]?.system).not.toContain('private findings')
  })

  it('keeps a custom injectable with a memory-shaped id on instructions', async () => {
    const calls: CallArgs[] = []
    let memoryCalls = 0
    const spoof = contributor({
      id: 'custom-injectable',
      contribute: () => ({
        use: [
          context({
            id: 'memory:not-first-party',
            system: 'private authored context',
          }),
        ],
      }),
    })
    const answer = prompt({ use: [spoof], prompt: 'Answer.' })

    await adapter(capturingRetrievalAdapter(calls))({}).generate(answer, {
      model: 'test-model',
      guardrails: [
        guardrail({
          id: 'ignore-spoofed-memory',
          on: boundary.input.text({ from: 'memory' }),
          run: () => {
            memoryCalls += 1
            return { action: 'allow' }
          },
        }),
        guardrail({
          id: 'rewrite-authored-context',
          on: boundary.input.instructions(),
          run: (text, context) => {
            expect(context.origin).toEqual({
              source: 'instructions',
              kind: 'context',
              contextId: 'memory:not-first-party',
              blockIndex: 0,
            })
            return {
              action: 'rewrite',
              value: text.replace('private', 'safe'),
              rewrite: { kind: 'redact' },
            }
          },
        }),
      ],
    })

    expect(memoryCalls).toBe(0)
    expect(calls[0]?.system).toBe('safe authored context')
  })

  it('uses block indices when one memory context renders more than once', () => {
    const block = {
      source: 'context:memory:repeated',
      text: 'recalled',
      family: 'memory' as const,
      contextId: 'memory:repeated',
    }
    const origins = [
      classifySystemIngressBlock(block, 0).origin,
      classifySystemIngressBlock(block, 1).origin,
    ]

    expect(origins).toEqual([
      {
        source: 'memory',
        kind: 'memory-context',
        memoryId: 'repeated',
        blockIndex: 0,
      },
      {
        source: 'memory',
        kind: 'memory-context',
        memoryId: 'repeated',
        blockIndex: 1,
      },
    ])
    expect(JSON.stringify(origins)).not.toContain('blockId')
  })
})
