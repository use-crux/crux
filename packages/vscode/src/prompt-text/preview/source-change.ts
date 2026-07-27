import {
  transformPreviewOffsets,
  type PromptTextPreviewOffsetChange,
} from './range.js'
import type { PromptTextPreviewSlots } from './slots.js'
import type {
  MutablePromptTextPreviewSlot,
  PromptTextPreviewControllerPorts,
  PromptTextPreviewSource,
} from './types.js'

/**
 * Clear, transform, rekey, and schedule every tracked slot after one edit.
 *
 * Document lengths and change offsets are pre-event UTF-16 code units.
 * Invalid transforms detach only their originating slot; valid transforms
 * schedule one exact refresh after 150 ms.
 */
export function updatePromptTextPreviewSource(
  slots: PromptTextPreviewSlots,
  ports: Pick<PromptTextPreviewControllerPorts, 'clear' | 'refreshing'>,
  source: PromptTextPreviewSource,
  previousDocumentLength: number,
  changes: readonly PromptTextPreviewOffsetChange[],
  refresh: (slot: MutablePromptTextPreviewSlot, generation: number) => void,
): void {
  const tracked = slots
    .values()
    .filter((slot) => slot.sourceUri === source.uri && slot.tracked)
  for (const slot of tracked) {
    if (!slot.tracked) continue
    const generation = ++slot.generation
    if (slot.refreshTimer !== undefined) clearTimeout(slot.refreshTimer)
    const offsets =
      slot.documentLength === previousDocumentLength
        ? transformPreviewOffsets(slot.offsets, previousDocumentLength, changes)
        : undefined
    const start =
      offsets === undefined ? undefined : source.positionAt(offsets.start)
    const end =
      offsets === undefined ? undefined : source.positionAt(offsets.end)
    if (offsets === undefined || start === undefined || end === undefined) {
      slots.lose(slot)
      ports.clear(slot, 'target-lost')
      continue
    }
    const rekeyed = slots.rekey(slot, { start, end })
    if (rekeyed.ambiguous !== undefined) {
      slots.lose(rekeyed.ambiguous)
      ports.clear(rekeyed.ambiguous, 'template-ambiguous')
    }
    if (!rekeyed.kept) continue
    slot.offsets = offsets
    slot.documentLength = source.documentLength
    ports.refreshing(slot)
    slot.refreshTimer = setTimeout(() => {
      slot.refreshTimer = undefined
      refresh(slot, generation)
    }, 150)
  }
}
