import { describe, expect, it, vi } from 'vitest'
import { PromptTextPreviewController } from './controller.js'
import { previewSource, range, readyResult } from './test-fixtures.js'
import type { PromptTextPreviewStaticResult } from './types.js'

describe('PromptTextPreviewController rematch association races', () => {
  it('does not clear a same-range slot created after an unassociated send', async () => {
    const source = previewSource()
    const selected = { ordinal: 0, range: range(3, 1, 5, 2) }
    const rematch = deferred<PromptTextPreviewStaticResult>()
    let request = 0
    const clear = vi.fn()
    const publish = vi.fn(async () => 'exact' as const)
    const controller = new PromptTextPreviewController({
      currentSource: () => source,
      request: async () => {
        request++
        if (request === 1) return chooseResult(source, selected)
        if (request === 2) return rematch.promise
        return readyResult(source, selected.range)
      },
      choose: async () => selected,
      publish,
      clear,
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    })
    const pending = controller.preview(source, { line: 0, character: 0 })
    await vi.waitFor(() => expect(request).toBe(2))

    await controller.preview(source, { line: 3, character: 2 })
    rematch.resolve(unavailableResult(source))
    await pending

    expect(clear).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledOnce()
    expect(controller.activeSlotCount).toBe(1)
  })

  it('does not clear a newer generation of the associated exact slot', async () => {
    const source = previewSource()
    const selected = { ordinal: 0, range: range(3, 1, 5, 2) }
    const rematch = deferred<PromptTextPreviewStaticResult>()
    let request = 0
    const clear = vi.fn()
    const publish = vi.fn(async () => 'exact' as const)
    const controller = new PromptTextPreviewController({
      currentSource: () => source,
      request: async () => {
        request++
        if (request === 1) return readyResult(source, selected.range)
        if (request === 2) return chooseResult(source, selected)
        if (request === 3) return rematch.promise
        return readyResult(source, selected.range)
      },
      choose: async () => selected,
      publish,
      clear,
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    })
    await controller.preview(source, { line: 3, character: 2 })
    const pending = controller.preview(source, { line: 0, character: 0 })
    await vi.waitFor(() => expect(request).toBe(3))

    await controller.preview(source, { line: 3, character: 2 })
    rematch.resolve(unavailableResult(source))
    await pending

    expect(clear).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(controller.activeSlotCount).toBe(1)
  })

  it('cancels an associated rematch when its virtual resource closes', async () => {
    const source = previewSource()
    const selected = { ordinal: 0, range: range(3, 1, 5, 2) }
    const rematch = deferred<PromptTextPreviewStaticResult>()
    let request = 0
    let rematchSignal: AbortSignal | undefined
    const publish = vi.fn(async () => 'exact' as const)
    const controller = new PromptTextPreviewController({
      currentSource: () => source,
      request: async (_params, signal) => {
        request++
        if (request === 1) return readyResult(source, selected.range)
        if (request === 2) return chooseResult(source, selected)
        rematchSignal = signal
        return rematch.promise
      },
      choose: async () => selected,
      publish,
      clear: vi.fn(),
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    })
    await controller.preview(source, { line: 3, character: 2 })
    const pending = controller.preview(source, { line: 0, character: 0 })
    await vi.waitFor(() => expect(request).toBe(3))

    controller.resourceClosed(1)
    rematch.resolve(readyResult(source, selected.range))
    await pending

    expect(rematchSignal?.aborted).toBe(true)
    expect(publish).toHaveBeenCalledOnce()
    expect(controller.activeSlotCount).toBe(0)
  })
})

function chooseResult(
  source: ReturnType<typeof previewSource>,
  selected: {
    readonly ordinal: number
    readonly range: ReturnType<typeof range>
  },
): PromptTextPreviewStaticResult {
  return {
    ...resultStamp(source),
    kind: 'choose',
    requestStatus: 'complete',
    choices: [selected],
  }
}

function unavailableResult(
  source: ReturnType<typeof previewSource>,
): PromptTextPreviewStaticResult {
  return {
    ...resultStamp(source),
    kind: 'unavailable',
    reason: 'analysis-unavailable',
  }
}

function resultStamp(source: ReturnType<typeof previewSource>) {
  return {
    protocolVersion: 1 as const,
    uri: source.uri,
    openEpoch: source.openEpoch,
    version: source.version,
    sourceHash: source.sourceHash,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
