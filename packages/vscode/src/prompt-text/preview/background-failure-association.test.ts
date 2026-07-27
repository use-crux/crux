import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptTextPreviewController } from './controller.js'
import { previewSource, range, readyResult } from './test-fixtures.js'
import type {
  PromptTextPreviewSource,
  PromptTextPreviewStaticResult,
} from './types.js'

describe('PromptTextPreviewController background failure association', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears only the originating slot after a current failure', async () => {
    vi.useFakeTimers()
    const original = previewSource()
    const changed = appendedSource(original, 'x', 8, 'b')
    const explicit = [range(0, 0, 0, 1), range(3, 1, 5, 2)]
    let current = original
    const clear = vi.fn()
    const publications: number[] = []
    const controller = new PromptTextPreviewController({
      currentSource: () => current,
      request: async (params) => {
        if (params.target.kind === 'position') {
          return readyResult(original, explicit.shift()!)
        }
        return params.target.range.start.line === 0
          ? {
              ...resultStamp(changed),
              kind: 'unavailable',
              reason: 'analysis-unavailable',
            }
          : readyResult(changed, params.target.range)
      },
      choose: vi.fn(),
      publish: async (slot) => {
        publications.push(slot.id)
        return 'exact'
      },
      clear,
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    })
    await controller.preview(original, { line: 0, character: 0 })
    await controller.preview(original, { line: 3, character: 2 })
    clear.mockClear()

    current = changed
    controller.sourceChanged(changed, original.documentLength, [
      appendChange(original, 'x'),
    ])
    await vi.advanceTimersByTimeAsync(150)

    expect(clear).toHaveBeenCalledOnce()
    expect(clear).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'analysis-unavailable',
    )
    expect(publications).toEqual([1, 2, 2])
  })

  it('silently discards a failure superseded by a newer generation', async () => {
    vi.useFakeTimers()
    const original = previewSource()
    const changed = appendedSource(original, 'x', 8, 'b')
    const newest = appendedSource(changed, 'y', 9, 'c')
    const pending = deferred<PromptTextPreviewStaticResult>()
    let current = original
    let refresh = 0
    const clear = vi.fn()
    const controller = new PromptTextPreviewController({
      currentSource: () => current,
      request: async (params) => {
        if (params.target.kind === 'position') return readyResult(original)
        refresh++
        return refresh === 1
          ? pending.promise
          : readyResult(newest, params.target.range)
      },
      choose: vi.fn(),
      publish: async () => 'exact',
      clear,
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    })
    await controller.preview(original, { line: 3, character: 2 })

    current = changed
    controller.sourceChanged(changed, original.documentLength, [
      appendChange(original, 'x'),
    ])
    await vi.advanceTimersByTimeAsync(150)
    current = newest
    controller.sourceChanged(newest, changed.documentLength, [
      appendChange(changed, 'y'),
    ])
    pending.resolve({
      ...resultStamp(changed),
      kind: 'unavailable',
      reason: 'analysis-unavailable',
    })
    await vi.advanceTimersByTimeAsync(150)

    expect(clear).not.toHaveBeenCalled()
    expect(refresh).toBe(2)
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

function appendedSource(
  source: ReturnType<typeof previewSource>,
  text: string,
  version: number,
  hash: string,
) {
  return previewSource(`${source.text}${text}`, {
    version,
    sourceHash: hash.repeat(64),
  })
}

function appendChange(source: PromptTextPreviewSource, text: string) {
  return {
    rangeOffset: source.documentLength,
    rangeLength: 0,
    text,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
