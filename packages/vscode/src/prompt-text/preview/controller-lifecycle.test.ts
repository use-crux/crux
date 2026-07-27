import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptTextPreviewController } from './controller.js'
import { previewSource, range, readyResult } from './test-fixtures.js'
import type {
  PromptTextPreviewReadyResult,
  PromptTextPreviewStaticResult,
} from './types.js'

describe('PromptTextPreviewController lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears an existing chosen range when exact rematch becomes unavailable', async () => {
    const source = previewSource()
    const selected = { ordinal: 0, range: range(3, 1, 5, 2) }
    const clear = vi.fn()
    const showInformation = vi.fn()
    let response = 0
    const controller = new PromptTextPreviewController({
      currentSource: () => source,
      request: async (): Promise<PromptTextPreviewStaticResult> => {
        response++
        if (response === 1) return readyResult(source, selected.range)
        if (response === 2) {
          return {
            ...resultStamp(source),
            kind: 'choose',
            requestStatus: 'complete',
            choices: [selected],
          }
        }
        return {
          ...resultStamp(source),
          kind: 'unavailable',
          reason: 'template-not-found',
        }
      },
      choose: async () => selected,
      publish: async () => 'exact',
      clear,
      refreshing: vi.fn(),
      showInformation,
    })
    await controller.preview(source, { line: 3, character: 2 })

    await controller.preview(source, { line: 3, character: 2 })

    expect(clear).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'template-not-found',
    )
    expect(showInformation).toHaveBeenLastCalledWith(
      'No PromptText template was found at the selected location.',
    )
  })

  it('clears the exact chosen slot when its rematch stamp is stale', async () => {
    const source = previewSource()
    const selected = { ordinal: 0, range: range(3, 1, 5, 2) }
    const clear = vi.fn()
    let response = 0
    const controller = new PromptTextPreviewController({
      currentSource: () => source,
      request: async (): Promise<PromptTextPreviewStaticResult> => {
        response++
        if (response === 1) return readyResult(source, selected.range)
        if (response === 2) {
          return {
            ...resultStamp(source),
            kind: 'choose',
            requestStatus: 'complete',
            choices: [selected],
          }
        }
        return {
          ...resultStamp(source),
          version: source.version + 1,
          kind: 'unavailable',
          reason: 'revision-mismatch',
        }
      },
      choose: async () => selected,
      publish: async () => 'exact',
      clear,
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    })
    await controller.preview(source, { line: 3, character: 2 })

    await controller.preview(source, { line: 3, character: 2 })

    expect(clear).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'analysis-unavailable',
    )
  })

  it('detaches on rename and never follows a later open at the old URI', async () => {
    const source = previewSource()
    const publish = vi.fn(async () => 'exact' as const)
    const controller = controllerFor(source, readyResult(source), { publish })
    await controller.preview(source, { line: 3, character: 2 })

    controller.sourceRenamed(source.uri)
    await controller.sourceOpened(source)

    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('clears on disconnect then repulls open retained targets after connect', async () => {
    const source = previewSource()
    const refreshing = vi.fn()
    const publish = vi.fn(
      async (
        _slot: unknown,
        _ready: PromptTextPreviewReadyResult,
        reveal: boolean,
      ) => (reveal ? ('exact' as const) : ('exact' as const)),
    )
    const controller = controllerFor(source, readyResult(source), {
      publish,
      refreshing,
    })
    await controller.preview(source, { line: 3, character: 2 })

    controller.disconnected()
    await controller.refresh()

    expect(refreshing).toHaveBeenCalled()
    expect(publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ kind: 'ready' }),
      false,
    )
  })

  it('keeps sixteen slots and rejects a seventeenth without eviction', async () => {
    const source = previewSource('x'.repeat(80))
    const showInformation = vi.fn()
    const controller = new PromptTextPreviewController({
      currentSource: () => source,
      request: async (params) => {
        const character =
          params.target.kind === 'position'
            ? params.target.position.character
            : params.target.range.start.character
        return readyResult(source, range(0, character, 0, character + 1))
      },
      choose: vi.fn(),
      publish: async () => 'exact',
      clear: vi.fn(),
      refreshing: vi.fn(),
      showInformation,
    })
    for (let character = 0; character < 17; character++) {
      await controller.preview(source, { line: 0, character })
    }

    expect(controller.activeSlotCount).toBe(16)
    expect(showInformation).toHaveBeenCalledWith(
      'Crux already has 16 static previews open. Close one before opening another.',
    )
  })

  it('silently discards an explicit pull canceled by a source edit', async () => {
    const original = previewSource()
    const changed = previewSource(`${original.text}x`, {
      version: original.version + 1,
      sourceHash: 'd'.repeat(64),
    })
    let current = original
    const showInformation = vi.fn()
    const controller = new PromptTextPreviewController({
      currentSource: () => current,
      request: (_params, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('canceled')))
        }),
      choose: vi.fn(),
      publish: vi.fn(),
      clear: vi.fn(),
      refreshing: vi.fn(),
      showInformation,
    })
    const pending = controller.preview(original, { line: 3, character: 2 })

    current = changed
    controller.sourceChanged(changed, original.documentLength, [
      {
        rangeOffset: original.documentLength,
        rangeLength: 0,
        text: 'x',
      },
    ])
    await pending

    expect(showInformation).not.toHaveBeenCalled()
  })
})

function controllerFor(
  source: ReturnType<typeof previewSource>,
  result: PromptTextPreviewReadyResult,
  overrides: Partial<{
    publish: (
      slot: unknown,
      ready: PromptTextPreviewReadyResult,
      reveal: boolean,
    ) => Promise<'exact'>
    refreshing: () => void
  }> = {},
) {
  return new PromptTextPreviewController({
    currentSource: () => source,
    request: async () => result,
    choose: vi.fn(),
    publish: overrides.publish ?? (async () => 'exact'),
    clear: vi.fn(),
    refreshing: overrides.refreshing ?? vi.fn(),
    showInformation: vi.fn(),
  })
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
