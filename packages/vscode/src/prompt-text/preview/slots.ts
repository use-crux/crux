import { previewSlotKey, type PromptTextPreviewOffsetRange } from './range.js'
import type {
  MutablePromptTextPreviewSlot,
  PromptTextPreviewSource,
} from './types.js'
import type { Utf16Range } from '../contracts.js'

/** Atomic tracking result when an edited range receives a new registry key. */
export interface PromptTextPreviewRekeyResult {
  readonly kept: boolean
  readonly ambiguous?: MutablePromptTextPreviewSlot
}

/** Slot identity frozen when an exact-range request begins. */
export interface PromptTextPreviewSlotAssociation {
  readonly slotId: number
  readonly generation: number
  readonly sourceUri: string
  readonly range: Utf16Range
}

/** Bounded atomic indexes for active and currently tracked preview resources. */
export class PromptTextPreviewSlots {
  readonly #byId = new Map<number, MutablePromptTextPreviewSlot>()
  readonly #byKey = new Map<string, MutablePromptTextPreviewSlot>()
  #nextId = 0

  constructor(private readonly maximum: number) {}

  /** Number of open resources, including retained detached resources. */
  get size(): number {
    return this.#byId.size
  }

  /** Snapshot all open slots in monotonically increasing ID order. */
  values(): readonly MutablePromptTextPreviewSlot[] {
    return [...this.#byId.values()]
  }

  /** Find only the currently attached slot for an exact URI/range key. */
  find(
    sourceUri: string,
    range: Utf16Range,
  ): MutablePromptTextPreviewSlot | undefined {
    return this.#byKey.get(previewSlotKey(sourceUri, range))
  }

  /** Freeze an attached exact slot's ID and generation before sending work. */
  associate(
    sourceUri: string,
    range: Utf16Range,
  ): PromptTextPreviewSlotAssociation | undefined {
    const slot = this.find(sourceUri, range)
    return slot === undefined
      ? undefined
      : {
          slotId: slot.id,
          generation: slot.generation,
          sourceUri,
          range,
        }
  }

  /** Resolve only the same still-attached key, slot ID, and generation. */
  associated(
    association: PromptTextPreviewSlotAssociation,
  ): MutablePromptTextPreviewSlot | undefined {
    const slot = this.find(association.sourceUri, association.range)
    return slot?.id === association.slotId &&
      slot.generation === association.generation
      ? slot
      : undefined
  }

  /**
   * Reattach an exact matching resource before allocating within the bound.
   * Range offsets and document length are UTF-16 code-unit measurements.
   */
  reserve(
    source: PromptTextPreviewSource,
    range: Utf16Range,
    offsets: PromptTextPreviewOffsetRange,
  ): MutablePromptTextPreviewSlot | undefined {
    const key = previewSlotKey(source.uri, range)
    const existing = this.#byKey.get(key) ?? this.#findDetached(key)
    if (existing !== undefined) {
      existing.range = range
      existing.offsets = offsets
      existing.documentLength = source.documentLength
      existing.tracked = true
      this.#byKey.set(key, existing)
      return existing
    }
    if (this.#byId.size >= this.maximum) return undefined
    const slot: MutablePromptTextPreviewSlot = {
      id: ++this.#nextId,
      sourceUri: source.uri,
      sourcePath: source.sourcePath,
      initialLine: range.start.line + 1,
      range,
      offsets,
      documentLength: source.documentLength,
      generation: 0,
      tracked: true,
    }
    this.#byId.set(slot.id, slot)
    this.#byKey.set(key, slot)
    return slot
  }

  #findDetached(key: string): MutablePromptTextPreviewSlot | undefined {
    for (const slot of this.#byId.values()) {
      if (!slot.tracked && previewSlotKey(slot.sourceUri, slot.range) === key) {
        return slot
      }
    }
    return undefined
  }

  /** Remove the registry key while retaining the open resource and slot ID. */
  detach(slot: MutablePromptTextPreviewSlot): void {
    const key = previewSlotKey(slot.sourceUri, slot.range)
    if (this.#byKey.get(key) === slot) this.#byKey.delete(key)
    slot.tracked = false
  }

  /** Detach, invalidate in-flight generations, and cancel deferred refresh. */
  lose(slot: MutablePromptTextPreviewSlot): void {
    this.detach(slot)
    ++slot.generation
    this.cancelPending(slot)
  }

  /** Cancel one slot's pending 150 ms refresh without changing its identity. */
  cancelPending(slot: MutablePromptTextPreviewSlot): void {
    if (slot.refreshTimer !== undefined) {
      clearTimeout(slot.refreshTimer)
      slot.refreshTimer = undefined
    }
  }

  /** Atomically move one registry key, retaining the lower ID on collision. */
  rekey(
    slot: MutablePromptTextPreviewSlot,
    range: Utf16Range,
  ): PromptTextPreviewRekeyResult {
    this.detach(slot)
    const key = previewSlotKey(slot.sourceUri, range)
    const collision = this.#byKey.get(key)
    if (collision === undefined) {
      slot.range = range
      slot.tracked = true
      this.#byKey.set(key, slot)
      return { kept: true }
    }
    if (collision.id < slot.id) {
      return { kept: false, ambiguous: slot }
    }
    this.detach(collision)
    slot.range = range
    slot.tracked = true
    this.#byKey.set(key, slot)
    return { kept: true, ambiguous: collision }
  }

  /** Permanently remove one slot after its last virtual document closes. */
  close(slotId: number): MutablePromptTextPreviewSlot | undefined {
    const slot = this.#byId.get(slotId)
    if (slot === undefined) return undefined
    this.detach(slot)
    this.#byId.delete(slotId)
    return slot
  }

  /** Forget every active and detached resource during owner disposal. */
  clear(): void {
    this.#byKey.clear()
    this.#byId.clear()
  }
}
