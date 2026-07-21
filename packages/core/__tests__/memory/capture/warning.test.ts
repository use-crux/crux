import { afterEach, describe, expect, it, vi } from 'vitest'

const FALLBACK_WARNING =
  '[crux] Deferred memory capture ran inline because the active environment cannot retain background work. Memory was captured safely, but the operation waited for it to finish. Configure a host binding to enable background capture: https://cruxjs.dev/docs/guides/background-work/hosts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('memory capture fallback warning', () => {
  it('warns with the exact guidance once for repeated development fallbacks', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const { memory, memoryBlock } = await import('../../../src/memory')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mem = memory({
      id: 'warning-fallback',
      namespace: 'thread:1',
      blocks: [memoryBlock({ id: 'capture', kind: 'custom' })],
    })

    await mem.captureTurn({ messages: [] })
    await mem.captureTurn({ messages: [] })

    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(FALLBACK_WARNING)
  })

  it('does not warn in production, test, inline, or Eval capture paths', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    for (const environment of ['production', 'test'] as const) {
      vi.stubEnv('NODE_ENV', environment)
      vi.resetModules()
      const { memory, memoryBlock } = await import('../../../src/memory')
      const mem = memory({
        id: `${environment}-fallback`,
        namespace: 'thread:1',
        blocks: [memoryBlock({ id: 'capture', kind: 'custom' })],
      })
      await mem.captureTurn({ messages: [] })
    }

    vi.stubEnv('NODE_ENV', 'development')
    vi.resetModules()
    const inlineMemory = await import('../../../src/memory')
    const inline = inlineMemory.memory({
      id: 'explicit-inline',
      namespace: 'thread:1',
      capture: { mode: 'inline' },
      blocks: [
        inlineMemory.memoryBlock({ id: 'capture', kind: 'custom' }),
      ],
    })
    await inline.captureTurn({ messages: [] })

    vi.resetModules()
    const [{ memory, memoryBlock }, { runEvalCellScope, runEvalScope }] =
      await Promise.all([
        import('../../../src/memory'),
        import('../../../src/eval/internal/scope'),
      ])
    const evaluated = memory({
      id: 'eval-captured',
      namespace: 'thread:1',
      blocks: [memoryBlock({ id: 'capture', kind: 'custom' })],
    })
    await runEvalScope('memory-warning', () =>
      runEvalCellScope(
        { caseId: 'warning', variant: 'current', trial: 0 },
        () => evaluated.captureTurn({ messages: [] }),
      ),
    )

    expect(warn).not.toHaveBeenCalled()
  })
})
