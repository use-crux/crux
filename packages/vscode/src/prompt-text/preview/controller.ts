import type { Utf16Position } from '../contracts.js'
import type { PromptTextPreviewOffsetChange } from './range.js'
import { validatePromptTextPreviewRefresh } from './refresh-result.js'
import {
  promptTextPreviewFailure,
  resolvePromptTextPreview,
} from './selection.js'
import {
  promptTextPreviewCapacityMessage,
  promptTextPreviewEOLMessage,
  promptTextPreviewUnavailableMessage,
} from './metadata.js'
import { PromptTextPreviewSlots } from './slots.js'
import { PromptTextPreviewRequests } from './requests.js'
import { updatePromptTextPreviewSource } from './source-change.js'
import { samePromptTextPreviewStamp } from './wire.js'
import type {
  MutablePromptTextPreviewSlot,
  PromptTextPreviewControllerPorts,
  PromptTextPreviewReadyResult,
  PromptTextPreviewSource,
} from './types.js'

/**
 * Owns bounded preview slots and rejects work that no longer matches its
 * source revision or tracked template range.
 * VS Code lifecycle adapters feed this class events; wire validation,
 * selection, range transforms, and metadata remain plain functions.
 */
export class PromptTextPreviewController {
  readonly #slots = new PromptTextPreviewSlots(16)
  readonly #requests: PromptTextPreviewRequests
  #disposed = false

  constructor(private readonly ports: PromptTextPreviewControllerPorts) {
    this.#requests = new PromptTextPreviewRequests(ports.request)
  }
  /** Count open resources, including detached unavailable tabs. */
  get activeSlotCount(): number {
    return this.#slots.size
  }
  /**
   * Pull and present one template selected from the exact active source.
   * A Quick Pick selection is always rematched by a second range request.
   */
  async preview(
    source: PromptTextPreviewSource,
    position: Utf16Position,
  ): Promise<void> {
    if (this.#disposed) return
    const result = await resolvePromptTextPreview(
      source,
      position,
      this.#requests,
      (choices) => this.ports.choose(choices),
      (range) => this.#slots.associate(source.uri, range),
    )
    if (result.kind === 'ready') {
      if (
        result.association !== undefined &&
        this.#slots.associated(result.association) === undefined
      )
        return
      await this.#applyReady(source, result.ready)
      return
    }
    const failure = promptTextPreviewFailure(result)
    if (failure === undefined) return
    const current = this.ports.currentSource(source.uri)
    if (current === undefined || !samePromptTextPreviewStamp(source, current))
      return
    if (failure.association !== undefined) {
      const slot = this.#slots.associated(failure.association)
      if (slot === undefined) return
      this.ports.clear(slot, failure.reason)
    }
    if (failure.notify) {
      this.ports.showInformation(
        promptTextPreviewUnavailableMessage(failure.reason),
      )
    }
  }
  /**
   * Clear and retarget every active slot for one post-event source revision.
   * All change offsets are measured against `previousDocumentLength`.
   */
  sourceChanged(
    source: PromptTextPreviewSource,
    previousDocumentLength: number,
    changes: readonly PromptTextPreviewOffsetChange[],
  ): void {
    if (this.#disposed) return
    this.#requests.cancelSource(source.uri)
    updatePromptTextPreviewSource(
      this.#slots,
      this.ports,
      source,
      previousDocumentLength,
      changes,
      (slot, generation) => {
        void this.#refreshSlot(slot, source, generation)
      },
    )
  }
  /** Clear retained resources when their source document closes. */
  sourceClosed(uri: string): void {
    this.#requests.cancelSource(uri)
    for (const slot of this.#slots.values()) {
      if (slot.sourceUri !== uri) continue
      ++slot.generation
      this.#slots.cancelPending(slot)
      this.ports.clear(slot, 'source-closed')
    }
  }
  /** Repull ranges only after the new didOpen stamp exists. */
  async sourceOpened(source: PromptTextPreviewSource): Promise<void> {
    await this.#refreshSource(source)
  }
  /** Detach a renamed source without following it. */
  sourceRenamed(uri: string): void {
    this.#requests.cancelSource(uri)
    for (const slot of this.#slots.values()) {
      if (slot.sourceUri !== uri) continue
      this.#slots.lose(slot)
      this.ports.clear(slot, 'source-closed')
    }
  }
  /** Clear and repull every tracked slot whose source remains open. */
  async refresh(): Promise<void> {
    const sources = new Map<string, PromptTextPreviewSource>()
    for (const slot of this.#slots.values()) {
      if (!slot.tracked || sources.has(slot.sourceUri)) continue
      const source = this.ports.currentSource(slot.sourceUri)
      if (source !== undefined) sources.set(slot.sourceUri, source)
    }
    await Promise.all(
      [...sources.values()].map((source) => this.#refreshSource(source)),
    )
  }

  /** Cancel and clear bytes while the language client is being replaced. */
  disconnected(): void {
    this.#requests.dispose()
    for (const slot of this.#slots.values()) {
      if (!slot.tracked) continue
      ++slot.generation
      this.ports.refreshing(slot)
    }
  }

  /** Release one slot after its virtual document has actually closed. */
  resourceClosed(slotId: number): void {
    const slot = this.#slots.close(slotId)
    if (slot === undefined) return
    ++slot.generation
    this.#slots.cancelPending(slot)
    this.#requests.cancelSlot(slotId)
  }

  /** Cancel all work and release every controller-owned slot and timer. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#requests.dispose()
    for (const slot of this.#slots.values()) {
      this.#slots.cancelPending(slot)
    }
    this.#slots.clear()
  }

  async #applyReady(
    source: PromptTextPreviewSource,
    ready: PromptTextPreviewReadyResult,
  ): Promise<void> {
    const current = this.ports.currentSource(source.uri)
    if (
      current === undefined ||
      !samePromptTextPreviewStamp(ready, current) ||
      !samePromptTextPreviewStamp(source, current)
    )
      return

    const startOffset = source.offsetAt(ready.selection.range.start)
    const endOffset = source.offsetAt(ready.selection.range.end)
    if (
      startOffset === undefined ||
      endOffset === undefined ||
      startOffset >= endOffset
    ) {
      this.ports.showInformation(
        promptTextPreviewUnavailableMessage('analysis-unavailable'),
      )
      return
    }
    const slot = this.#slots.reserve(source, ready.selection.range, {
      start: startOffset,
      end: endOffset,
    })
    if (slot === undefined) {
      this.ports.showInformation(promptTextPreviewCapacityMessage)
      return
    }
    const generation = ++slot.generation
    const publication = await this.ports.publish(slot, ready, true)
    if (this.#disposed || generation !== slot.generation) return
    if (publication === 'resource-disposed') {
      this.resourceClosed(slot.id)
    } else if (publication !== 'exact') {
      this.ports.clear(slot, publication)
      if (publication === 'editor-eol-normalization') {
        this.ports.showInformation(promptTextPreviewEOLMessage)
      }
    }
  }

  async #refreshSlot(
    slot: MutablePromptTextPreviewSlot,
    source: PromptTextPreviewSource,
    generation: number,
  ): Promise<void> {
    if (this.#disposed || generation !== slot.generation) return
    const result = await this.#requests.pull(
      source,
      {
        kind: 'template-range',
        range: slot.range,
      },
      slot.id,
    )
    if (this.#disposed || generation !== slot.generation) return
    const validated = validatePromptTextPreviewRefresh(
      result,
      source,
      this.ports.currentSource(source.uri),
      slot.range,
    )
    if (validated.kind === 'discarded') return
    if (validated.kind === 'unavailable') {
      this.ports.clear(slot, validated.reason)
      return
    }
    const ready = validated.ready
    const startOffset = source.offsetAt(slot.range.start)
    const endOffset = source.offsetAt(slot.range.end)
    if (
      startOffset === undefined ||
      endOffset === undefined ||
      startOffset >= endOffset
    ) {
      this.#slots.lose(slot)
      this.ports.clear(slot, 'target-lost')
      return
    }
    slot.offsets = { start: startOffset, end: endOffset }
    slot.documentLength = source.documentLength
    const publication = await this.ports.publish(slot, ready, false)
    if (this.#disposed || generation !== slot.generation) return
    if (publication === 'resource-disposed') {
      this.resourceClosed(slot.id)
    } else if (publication !== 'exact') {
      this.ports.clear(slot, publication)
    }
  }

  async #refreshSource(source: PromptTextPreviewSource): Promise<void> {
    this.#requests.cancelSource(source.uri)
    const work: Promise<void>[] = []
    for (const slot of this.#slots.values()) {
      if (slot.sourceUri !== source.uri || !slot.tracked) continue
      this.ports.refreshing(slot)
      const generation = ++slot.generation
      this.#slots.cancelPending(slot)
      work.push(this.#refreshSlot(slot, source, generation))
    }
    await Promise.all(work)
  }
}
