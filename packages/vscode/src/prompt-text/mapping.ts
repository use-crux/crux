import type {
  PromptTextDecorationSpan,
  Utf16Range,
} from './contracts.js'
import type { PromptTextDecorationRole } from './types.js'

/** Decoration ranges grouped for one `setDecorations` call per visual role. */
export type PromptTextDecorationRanges = Readonly<
  Record<PromptTextDecorationRole, readonly Utf16Range[]>
>

/**
 * Group proven source ranges by their client presentation role.
 *
 * The input has already been classified outside the extension. This function
 * deliberately performs no Markdown parsing and preserves every UTF-16 range
 * exactly as supplied.
 *
 * @param payload - Fixture or production result containing proven role ranges.
 * @returns The same ranges grouped exhaustively by presentation role.
 */
export function mapPromptTextDecorationRanges(
  payload: { readonly decorations: readonly PromptTextDecorationSpan[] },
): PromptTextDecorationRanges {
  const ranges: Record<PromptTextDecorationRole, Utf16Range[]> = {
    heading: [],
    link: [],
    code: [],
    emphasis: [],
    strong: [],
    list: [],
    blockquote: [],
  }
  for (const decoration of payload.decorations) {
    ranges[decoration.role].push(decoration.range)
  }
  return ranges
}
