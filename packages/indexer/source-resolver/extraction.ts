/**
 * Pure function source extraction.
 *
 * The extractor is intentionally lightweight: source maps identify an original
 * line/column, and this function walks source text from that position until it
 * finds a balanced function-like region or reaches the configured line limit.
 *
 * @module
 */

import type { FunctionBodyExtraction } from './types'

/** Maximum number of source lines returned for a function source extraction. */
export const MAX_FN_EXTRACT_LINES = 200

/**
 * Extract function-like source text from `source` at a one-based line/column.
 *
 * This function is pure. It handles block functions, block arrow functions,
 * expression arrows, nested braces, quoted strings, and template literals well
 * enough for devtools source previews. It returns `null` when the start
 * position is outside the source text.
 */
export function extractFunctionBody(
  source: string,
  startLine: number,
  startColumn: number,
  maxLines = MAX_FN_EXTRACT_LINES,
): FunctionBodyExtraction | null {
  const lines = source.split('\n')
  if (startLine < 1 || startLine > lines.length) return null

  const lineIdx = startLine - 1
  const result: string[] = []
  let depth = 0
  let inString: string | null = null
  let inTemplate = false
  let templateDepth = 0
  let started = false

  for (let i = lineIdx; i < lines.length && i < lineIdx + maxLines; i++) {
    const currentLine = lines[i] ?? ''
    result.push(currentLine)

    for (let j = i === lineIdx ? startColumn : 0; j < currentLine.length; j++) {
      const ch = currentLine[j] ?? ''
      const prev = j > 0 ? (currentLine[j - 1] ?? '') : ''

      if (prev === '\\') continue

      if (inString) {
        if (ch === inString) inString = null
        continue
      }

      if (inTemplate) {
        if (ch === '`') {
          inTemplate = false
          continue
        }
        if (ch === '$' && currentLine[j + 1] === '{') {
          templateDepth++
          continue
        }
        if (ch === '}' && templateDepth > 0) {
          templateDepth--
          continue
        }
        continue
      }

      if (ch === '"' || ch === "'") {
        inString = ch
        continue
      }
      if (ch === '`') {
        inTemplate = true
        continue
      }

      if (ch === '{' || ch === '(') {
        depth++
        started = true
      }
      if (ch === '}' || ch === ')') {
        depth--
      }
    }

    if (started && depth <= 0) {
      return { source: result.join('\n'), endLine: i + 1 }
    }
  }

  if (result.length > 0) return { source: result.join('\n'), endLine: lineIdx + result.length }
  return null
}
