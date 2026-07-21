import { describe, expect, it, vi } from 'vitest'
import { runEvalCellScope, runEvalScope } from '../../../src/eval/internal/scope'
import { memory, memoryBlock, recentMessages } from '../../../src/memory'
import { inMemoryRecordStore } from '../../../src/storage'

describe('memory capture in Eval', () => {
  it('suppresses default deferred capture in an Eval cell', async () => {
    const capture = vi.fn(async () => {})
    const mem = memory({
      id: 'eval-deferred',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: capture,
        }),
      ],
    })

    await runEvalScope('memory-deferred', () =>
      runEvalCellScope(
        { caseId: 'deferred', variant: 'current', trial: 0 },
        () =>
          mem.captureTurn({
            messages: [{ role: 'user', content: 'Do not persist' }],
          }),
      ),
    )

    expect(capture).not.toHaveBeenCalled()
  })

  it('executes explicit inline capture against isolated Eval storage', async () => {
    const records = inMemoryRecordStore()
    const recent = recentMessages({ id: 'recent', maxMessages: 5 })
    const mem = memory({
      id: 'eval-inline',
      records,
      namespace: 'thread:1',
      capture: { mode: 'inline' },
      blocks: [recent],
    })

    await runEvalScope('memory-inline', () =>
      runEvalCellScope(
        { caseId: 'inline', variant: 'current', trial: 0 },
        () =>
          mem.captureTurn({
            messages: [{ role: 'user', content: 'Persist in this Eval' }],
          }),
      ),
    )

    const entries = await recent.list({
      records,
      namespace: 'thread:1',
      memoryId: mem.id,
    })
    expect(entries.map((entry) => entry.content)).toEqual([
      'Persist in this Eval',
    ])
  })
})
