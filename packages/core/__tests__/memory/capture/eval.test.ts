import { describe, expect, it, vi } from 'vitest'
import { runEvalCellScope, runEvalScope } from '../../../src/eval/internal/scope'
import { memory, memoryBlock } from '../../../src/memory'
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
    const capture = vi.fn(async () => {})
    const mem = memory({
      id: 'eval-inline',
      records,
      namespace: 'thread:1',
      capture: { mode: 'inline' },
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: capture,
        }),
      ],
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

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({ content: 'Persist in this Eval' }),
        ],
      }),
      expect.objectContaining({
        records,
        namespace: 'thread:1',
        memoryId: mem.id,
      }),
    )
  })
})
