/** Deferred managed-memory capture retains its originating Safety session. */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { facts, memory } from '../../src/memory'
import { prompt as makePrompt } from '../../src/prompt/prompt'
import { config } from '../../src/runtime/config'
import { boundary, guardrail } from '../../src/safety'
import { inMemoryRecordStore } from '../../src/storage'
import { testAdapter } from './capture/fixtures'

describe('deferred managed memory write safety', () => {
  it('retains the originating per-call capability', async () => {
    const retained: Array<() => Promise<void>> = []
    const crux = config({
      host: {
        kind: 'memory-safety-session-test',
        invocationScope: true,
        retain(work) {
          retained.push(work)
        },
      },
    })
    const records = inMemoryRecordStore()
    const block = facts({
      id: 'deferred-facts',
      write: { mode: 'auto' },
      extract: async () => [{ content: 'raw candidate' }],
    })
    const mem = memory({
      id: 'deferred-safety',
      records,
      namespace: 'thread:1',
      capture: { mode: 'deferred' },
      blocks: [block],
    })
    const prompt = makePrompt({
      id: 'deferred-safety-prompt',
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    })
    const rewrite = (id: string, content: string) =>
      guardrail({
        id,
        on: boundary.memory.write<{ content: string }>(),
        run: () => ({
          action: 'rewrite' as const,
          value: { content },
          rewrite: { kind: 'normalize' as const },
        }),
      })

    try {
      await testAdapter().generate(prompt, {
        model: 'model-1',
        input: { message: 'first' },
        guardrails: [rewrite('first-memory-session', 'first guarded')],
      })
      await testAdapter().generate(prompt, {
        model: 'model-1',
        input: { message: 'second' },
        guardrails: [rewrite('second-memory-session', 'second guarded')],
      })

      expect(retained).toHaveLength(2)
      await retained[1]!()
      await retained[0]!()
      const entries = await block.list({
        records,
        namespace: 'thread:1',
        memoryId: 'deferred-safety',
      })
      expect(entries.map((entry) => entry.content).sort()).toEqual([
        'first guarded',
        'second guarded',
      ])
    } finally {
      crux.dispose()
    }
  })
})
