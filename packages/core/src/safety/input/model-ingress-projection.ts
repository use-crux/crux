import type {
  ModelIngressPatch,
  ModelIngressSlot,
  ModelIngressSlotKey,
} from './model-ingress-document'

/** @internal Project retained slots into bounded text with protected descriptors. */
export function projectModelIngressSlots(
  slots: readonly ModelIngressSlot[],
  removed: ReadonlySet<ModelIngressSlotKey>,
): string {
  return activeSlots(slots, removed)
    .map((slot) => (slot.kind === 'text' ? slot.value : slot.descriptor))
    .join('\n')
}

/** @internal Convert one guarded projection into keyed native text replacements. */
export function patchModelIngressText(
  slots: readonly ModelIngressSlot[],
  removed: ReadonlySet<ModelIngressSlotKey>,
  replacement: string,
): ReadonlyMap<ModelIngressSlotKey, string> | null {
  const active = activeSlots(slots, removed)
  const descriptors = active
    .filter((slot) => slot.kind !== 'text')
    .map((slot) => slot.descriptor)
  const textSlots = active.filter((slot) => slot.kind === 'text')

  if (descriptors.length === 0) {
    if (textSlots.length === 0) return replacement === '' ? new Map() : null
    const patch = new Map<ModelIngressSlotKey, string>()
    textSlots.forEach((slot, index) => {
      const value = index === 0 ? replacement : ''
      if (value !== slot.value) patch.set(slot.key, value)
    })
    return patch
  }
  if (textSlots.length === 0) return null
  if (
    textSlots.some((slot) =>
      descriptors.some((descriptor) => slot.value.includes(descriptor)),
    )
  ) {
    return null
  }

  const chunks: string[] = []
  let cursor = 0
  let pendingText = 0
  for (const slot of active) {
    if (slot.kind === 'text') {
      pendingText++
      continue
    }
    const descriptorIndex = replacement.indexOf(slot.descriptor, cursor)
    if (descriptorIndex < 0) return null
    assignTextChunk(
      chunks,
      pendingText,
      replacement.slice(cursor, descriptorIndex),
      descriptorIndex > cursor,
    )
    pendingText = 0
    cursor = descriptorIndex + slot.descriptor.length
  }
  assignTextChunk(chunks, pendingText, replacement.slice(cursor), false)
  if (chunks.length > textSlots.length) return null
  if (
    chunks.some((chunk) =>
      descriptors.some((descriptor) => chunk.includes(descriptor)),
    )
  ) {
    return null
  }

  const patch = new Map<ModelIngressSlotKey, string>()
  textSlots.forEach((slot, index) => {
    const value = chunks[index] ?? ''
    if (value !== slot.value) patch.set(slot.key, value)
  })
  return patch
}

/** @internal Return an immutable empty patch for an unchanged document. */
export function emptyModelIngressPatch(): ModelIngressPatch {
  return { kind: 'patch', text: new Map(), removed: new Set() }
}

function activeSlots(
  slots: readonly ModelIngressSlot[],
  removed: ReadonlySet<ModelIngressSlotKey>,
): readonly ModelIngressSlot[] {
  return slots.filter((slot) => !removed.has(slot.key))
}

function assignTextChunk(
  chunks: string[],
  pendingText: number,
  chunk: string,
  beforeProtected: boolean,
): void {
  if (pendingText === 0) return
  let text = chunk
  if (text.startsWith('\n')) text = text.slice(1)
  if (beforeProtected && text.endsWith('\n')) text = text.slice(0, -1)
  chunks.push(text)
  for (let index = 1; index < pendingText; index++) chunks.push('')
}
