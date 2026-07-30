import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptTextPreviewController } from './controller.js'
import { previewSource, range, readyResult } from './test-fixtures.js'
import type {
  PromptTextPreviewSource,
  PromptTextPreviewStaticResult,
} from './types.js'

describe('PromptTextPreviewController failure association', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    {
      name: 'unavailable',
      response: (source: PromptTextPreviewSource) => ({
        ...resultStamp(source),
        kind: 'unavailable' as const,
        reason: 'template-not-found' as const,
      }),
      messages: 1,
    },
    {
      name: 'transport',
      response: async () => {
        throw new Error('transport failed')
      },
      messages: 1,
    },
    {
      name: 'invalid or foreign',
      response: () => undefined,
      messages: 1,
    },
    {
      name: 'stale',
      response: (source: PromptTextPreviewSource) => ({
        ...resultStamp(source),
        version: source.version + 1,
        kind: 'unavailable' as const,
        reason: 'revision-mismatch' as const,
      }),
      messages: 0,
    },
  ])(
    'leaves every retained slot unchanged after a range-less $name result',
    async ({ response, messages }) => {
      const source = previewSource()
      const clear = vi.fn()
      const showInformation = vi.fn()
      let request = 0
      const retained = [range(0, 0, 0, 1), range(3, 1, 5, 2)]
      const controller = new PromptTextPreviewController({
        currentSource: () => source,
        request: async () => {
          request++
          return request <= retained.length
            ? readyResult(source, retained[request - 1]!)
            : await response(source)
        },
        choose: vi.fn(),
        publish: async () => 'exact',
        clear,
        refreshing: vi.fn(),
        showInformation,
      })
      await controller.preview(source, { line: 0, character: 0 })
      await controller.preview(source, { line: 3, character: 2 })
      clear.mockClear()

      await controller.preview(source, { line: 0, character: 0 })

      expect(clear).not.toHaveBeenCalled()
      expect(controller.activeSlotCount).toBe(2)
      expect(showInformation).toHaveBeenCalledTimes(messages)
    },
  )

  it('does not associate choose or Quick Pick cancellation with a slot', async () => {
    const source = previewSource()
    const clear = vi.fn()
    const publish = vi.fn(async () => 'exact' as const)
    let request = 0
    const controller = new PromptTextPreviewController({
      currentSource: () => source,
      request: async () => {
        request++
        return request === 1
          ? readyResult(source)
          : {
              ...resultStamp(source),
              kind: 'choose',
              requestStatus: 'complete',
              choices: [{ ordinal: 1, range: range(0, 0, 0, 1) }],
            }
      },
      choose: async () => undefined,
      publish,
      clear,
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    })
    await controller.preview(source, { line: 3, character: 2 })

    await controller.preview(source, { line: 0, character: 0 })

    expect(request).toBe(2)
    expect(publish).toHaveBeenCalledOnce()
    expect(clear).not.toHaveBeenCalled()
    expect(controller.activeSlotCount).toBe(1)
  })

  it('reuses only the exact range returned by a valid position result', async () => {
    const source = previewSource()
    const first = range(0, 0, 0, 1)
    const second = range(3, 1, 5, 2)
    const returned = [first, second, second]
    const publications: number[] = []
    const clear = vi.fn()
    const controller = new PromptTextPreviewController({
      currentSource: () => source,
      request: async () => readyResult(source, returned.shift()!),
      choose: vi.fn(),
      publish: async (slot) => {
        publications.push(slot.id)
        return 'exact'
      },
      clear,
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    })

    await controller.preview(source, { line: 0, character: 0 })
    await controller.preview(source, { line: 3, character: 2 })
    await controller.preview(source, { line: 1, character: 0 })

    expect(publications).toEqual([1, 2, 2])
    expect(clear).not.toHaveBeenCalled()
    expect(controller.activeSlotCount).toBe(2)
  })

  it.each([
    {
      name: 'unavailable',
      response: (source: PromptTextPreviewSource) => ({
        ...resultStamp(source),
        kind: 'unavailable' as const,
        reason: 'template-not-found' as const,
      }),
      reason: 'template-not-found',
    },
    {
      name: 'transport',
      response: async () => {
        throw new Error('transport failed')
      },
      reason: 'analysis-unavailable',
    },
    {
      name: 'invalid or foreign',
      response: () => undefined,
      reason: 'analysis-unavailable',
    },
  ])(
    'clears only an associated exact template-range after $name failure',
    async ({ response, reason }) => {
      const source = previewSource()
      const selected = { ordinal: 0, range: range(3, 1, 5, 2) }
      const clear = vi.fn()
      let request = 0
      const controller = new PromptTextPreviewController({
        currentSource: () => source,
        request: async () => {
          request++
          if (request === 1) return readyResult(source, selected.range)
          if (request === 2) {
            return {
              ...resultStamp(source),
              kind: 'choose',
              requestStatus: 'complete',
              choices: [selected],
            }
          }
          return await response(source)
        },
        choose: async () => selected,
        publish: async () => 'exact',
        clear,
        refreshing: vi.fn(),
        showInformation: vi.fn(),
      })
      await controller.preview(source, { line: 3, character: 2 })

      await controller.preview(source, { line: 0, character: 0 })

      expect(clear).toHaveBeenCalledOnce()
      expect(clear).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, range: selected.range }),
        reason,
      )
      expect(controller.activeSlotCount).toBe(1)
    },
  )

  it('creates nothing when a failed template-range has no exact slot', async () => {
    const source = previewSource()
    const selected = { ordinal: 0, range: range(0, 0, 0, 1) }
    const clear = vi.fn()
    let request = 0
    const controller = new PromptTextPreviewController({
      currentSource: () => source,
      request: async (): Promise<PromptTextPreviewStaticResult> => {
        request++
        return request === 1
          ? {
              ...resultStamp(source),
              kind: 'choose',
              requestStatus: 'complete',
              choices: [selected],
            }
          : {
              ...resultStamp(source),
              kind: 'unavailable',
              reason: 'template-not-found',
            }
      },
      choose: async () => selected,
      publish: vi.fn(),
      clear,
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    })

    await controller.preview(source, { line: 0, character: 0 })

    expect(clear).not.toHaveBeenCalled()
    expect(controller.activeSlotCount).toBe(0)
  })
})

function resultStamp(source: PromptTextPreviewSource) {
  return {
    protocolVersion: 1 as const,
    uri: source.uri,
    openEpoch: source.openEpoch,
    version: source.version,
    sourceHash: source.sourceHash,
  }
}
