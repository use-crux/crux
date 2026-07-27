/** Half-open UTF-16 offsets tracked against one source revision. */
export interface PromptTextPreviewOffsetRange {
  readonly start: number
  readonly end: number
}

/** One VS Code content change expressed against the pre-event document. */
export interface PromptTextPreviewOffsetChange {
  readonly rangeOffset?: number
  readonly rangeLength?: number
  readonly text: string
}

/**
 * Transform one exact template range through a VS Code edit event.
 *
 * Changes are validated against the same pre-event UTF-16 document and then
 * applied from right to left. Boundary-touching or ambiguous edits return
 * `undefined`; callers must clear rather than guess a new template identity.
 */
export function transformPreviewOffsets(
  target: PromptTextPreviewOffsetRange,
  documentLength: number,
  changes: readonly PromptTextPreviewOffsetChange[],
): PromptTextPreviewOffsetRange | undefined {
  if (
    !validOffset(target.start) ||
    !validOffset(target.end) ||
    target.start >= target.end ||
    target.end > documentLength ||
    !validOffset(documentLength)
  )
    return undefined

  const ranged = changes.map((change) => {
    if (
      !validOffset(change.rangeOffset) ||
      !validOffset(change.rangeLength) ||
      change.rangeOffset + change.rangeLength > documentLength
    ) {
      return undefined
    }
    return {
      start: change.rangeOffset,
      end: change.rangeOffset + change.rangeLength,
      textLength: change.text.length,
    }
  })
  if (ranged.some((change) => change === undefined)) return undefined

  const ordered = [...ranged] as Array<{
    readonly start: number
    readonly end: number
    readonly textLength: number
  }>
  ordered.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    if (
      previous !== undefined &&
      current !== undefined &&
      current.start < previous.end
    )
      return undefined
  }

  let start = target.start
  let end = target.end
  let postLength = documentLength
  for (let index = ordered.length - 1; index >= 0; index--) {
    const change = ordered[index]
    if (change === undefined) continue
    const replacedLength = change.end - change.start
    const delta = change.textLength - replacedLength
    postLength += delta
    if (!Number.isSafeInteger(postLength) || postLength < 0) return undefined

    if (replacedLength === 0) {
      if (change.start < start) {
        start += change.textLength
        end += change.textLength
      } else if (change.start > start && change.start < end) {
        end += change.textLength
      } else if (change.start === start || change.start === end) {
        return undefined
      }
      continue
    }
    if (change.end <= start) {
      start += delta
      end += delta
    } else if (change.start >= end) {
      continue
    } else if (change.start > start && change.end < end) {
      end += delta
    } else {
      return undefined
    }
  }
  if (
    !validOffset(start) ||
    !validOffset(end) ||
    start >= end ||
    end > postLength
  )
    return undefined
  return { start, end }
}

/** Stable registry key for one source URI and exact current template range. */
export function previewSlotKey(
  uri: string,
  range: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  },
): string {
  return `${uri}\n${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`
}

/** Compare exact UTF-16 range endpoints without deriving semantic identity. */
export function samePreviewRange(
  left: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  },
  right: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  },
): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  )
}

function validOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
