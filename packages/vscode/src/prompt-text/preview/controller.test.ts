import { afterEach, describe, expect, it, vi } from 'vitest'
import { PromptTextPreviewController } from './controller.js'
import type {
  PromptTextPreviewControllerPorts,
  PromptTextPreviewSource,
  PromptTextPreviewStaticParams,
} from './types.js'
import { previewSource, range, readyResult } from './test-fixtures.js'

describe('PromptTextPreviewController', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reuses one reserved slot for repeated ready results at the same exact range', async () => {
    const source = previewSource()
    const result = readyResult(source)
    const requests: PromptTextPreviewStaticParams[] = []
    const publications: Array<{
      readonly slotId: number
      readonly text: string
    }> = []
    const ports: PromptTextPreviewControllerPorts = {
      currentSource: (uri) => (uri === source.uri ? source : undefined),
      request: async (params) => {
        requests.push(params)
        return result
      },
      choose: vi.fn(),
      publish: async (slot, ready) => {
        publications.push({ slotId: slot.id, text: ready.text })
        return 'exact'
      },
      clear: vi.fn(),
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    }
    const controller = new PromptTextPreviewController(ports)

    await controller.preview(source, { line: 3, character: 7 })
    await controller.preview(source, { line: 3, character: 7 })

    expect(requests).toEqual([
      {
        protocolVersion: 1,
        uri: source.uri,
        openEpoch: source.openEpoch,
        version: source.version,
        sourceHash: source.sourceHash,
        target: { kind: 'position', position: { line: 3, character: 7 } },
      },
      {
        protocolVersion: 1,
        uri: source.uri,
        openEpoch: source.openEpoch,
        version: source.version,
        sourceHash: source.sourceHash,
        target: { kind: 'position', position: { line: 3, character: 7 } },
      },
    ])
    expect(publications).toEqual([
      { slotId: 1, text: '# Hello\n' },
      { slotId: 1, text: '# Hello\n' },
    ])
    expect(controller.activeSlotCount).toBe(1)
  })

  it('clears synchronously, transforms the exact range, and refreshes after 150 ms', async () => {
    vi.useFakeTimers()
    const original = previewSource('012345678901234567890123456789')
    const shifted = previewSource(`abc${original.text}`, {
      version: 8,
      sourceHash: 'b'.repeat(64),
    })
    let current = original
    const requests: PromptTextPreviewStaticParams[] = []
    const publications: Array<{
      readonly slotId: number
      readonly rangeStart: number
      readonly reveal: boolean
    }> = []
    const refreshing = vi.fn()
    const ports: PromptTextPreviewControllerPorts = {
      currentSource: (uri) => (uri === current.uri ? current : undefined),
      request: async (params) => {
        requests.push(params)
        return readyResult(
          current,
          params.target.kind === 'template-range'
            ? params.target.range
            : range(0, 10, 0, 20),
        )
      },
      choose: vi.fn(),
      publish: async (slot, ready, reveal) => {
        publications.push({
          slotId: slot.id,
          rangeStart: ready.selection.range.start.character,
          reveal,
        })
        return 'exact'
      },
      clear: vi.fn(),
      refreshing,
      showInformation: vi.fn(),
    }
    const controller = new PromptTextPreviewController(ports)
    await controller.preview(original, { line: 0, character: 12 })
    current = shifted

    controller.sourceChanged(shifted, original.documentLength, [
      {
        rangeOffset: 2,
        rangeLength: 0,
        text: 'abc',
      },
    ])

    expect(refreshing).toHaveBeenCalledOnce()
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(149)
    expect(requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(requests.at(-1)?.target).toEqual({
      kind: 'template-range',
      range: range(0, 13, 0, 23),
    })
    expect(publications).toEqual([
      { slotId: 1, rangeStart: 10, reveal: true },
      { slotId: 1, rangeStart: 13, reveal: false },
    ])
  })

  it('rematches a Quick Pick range and rejects a different ready selection', async () => {
    const source = previewSource()
    const choice = { ordinal: 2, range: range(3, 1, 5, 2) }
    const requests: PromptTextPreviewStaticParams[] = []
    const publish = vi.fn()
    const ports: PromptTextPreviewControllerPorts = {
      currentSource: () => source,
      request: async (params) => {
        requests.push(params)
        if (params.target.kind === 'position') {
          return {
            protocolVersion: 1,
            uri: source.uri,
            openEpoch: source.openEpoch,
            version: source.version,
            sourceHash: source.sourceHash,
            kind: 'choose',
            requestStatus: 'complete',
            choices: [choice],
          }
        }
        return readyResult(source, range(3, 2, 5, 2))
      },
      choose: async () => choice,
      publish,
      clear: vi.fn(),
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    }
    const controller = new PromptTextPreviewController(ports)

    await controller.preview(source, { line: 3, character: 7 })

    expect(requests.at(-1)?.target).toEqual({
      kind: 'template-range',
      range: choice.range,
    })
    expect(publish).not.toHaveBeenCalled()
    expect(controller.activeSlotCount).toBe(0)
  })

  it('retains a target-lost resource until its virtual document closes', async () => {
    const original = previewSource('012345678901234567890123456789')
    const changed = previewSource(`0123456789x${original.text.slice(10)}`, {
      version: 8,
      sourceHash: 'b'.repeat(64),
    })
    let current = original
    const clear = vi.fn()
    const controller = new PromptTextPreviewController({
      currentSource: () => current,
      request: async () => readyResult(original, range(0, 10, 0, 20)),
      choose: vi.fn(),
      publish: async () => 'exact',
      clear,
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    })
    await controller.preview(original, { line: 0, character: 12 })
    current = changed

    controller.sourceChanged(changed, original.documentLength, [
      {
        rangeOffset: 10,
        rangeLength: 0,
        text: 'x',
      },
    ])

    expect(clear).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1 }),
      'target-lost',
    )
    expect(controller.activeSlotCount).toBe(1)

    controller.resourceClosed(1)

    expect(controller.activeSlotCount).toBe(0)
  })

  it('retains a source-closed slot and reuses it only after a fresh ready response', async () => {
    const original = previewSource()
    const reopened = previewSource(undefined, {
      version: 1,
      sourceHash: 'c'.repeat(64),
      openEpoch: 3,
    })
    let current: PromptTextPreviewSource | undefined = original
    const clear = vi.fn()
    const publications: Array<{
      readonly id: number
      readonly reveal: boolean
    }> = []
    const controller = new PromptTextPreviewController({
      currentSource: () => current,
      request: async (params) =>
        readyResult(
          current ?? original,
          params.target.kind === 'template-range'
            ? params.target.range
            : range(3, 1, 5, 2),
        ),
      choose: vi.fn(),
      publish: async (slot, _ready, reveal) => {
        publications.push({ id: slot.id, reveal })
        return 'exact'
      },
      clear,
      refreshing: vi.fn(),
      showInformation: vi.fn(),
    })
    await controller.preview(original, { line: 3, character: 2 })

    current = undefined
    controller.sourceClosed(original.uri)

    expect(clear).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1 }),
      'source-closed',
    )
    expect(controller.activeSlotCount).toBe(1)

    current = reopened
    await controller.sourceOpened(reopened)

    expect(publications).toEqual([
      { id: 1, reveal: true },
      { id: 1, reveal: false },
    ])
    expect(controller.activeSlotCount).toBe(1)
  })
})
