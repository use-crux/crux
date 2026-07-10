/**
 * Zero-cost JSON text repair utility.
 *
 * Attempts to fix common malformed JSON from LLM outputs:
 * markdown code fences, preamble/postamble text, trailing commas.
 * Returns the repaired text if `JSON.parse()` succeeds, `null` if unfixable.
 *
 * @module
 */

/**
 * Attempt to repair malformed JSON text from LLM output.
 *
 * Applies repairs in order of increasing aggressiveness:
 * 1. Fast path — already valid JSON
 * 2. Whitespace trim
 * 3. Strip markdown code fences
 * 4. Fix trailing commas
 * 5. Extract JSON by bracket boundaries from surrounding text
 * 6. Combined: boundary extraction + trailing comma fix
 *
 * @param text - Raw text that should contain JSON.
 * @returns Cleaned JSON string if repairable, `null` if not.
 */
export function repairJsonText(text: string): string | null {
  if (!text) return null

  // Fast path: trim whitespace, check if already valid JSON
  const trimmed = text.trim()
  if (!trimmed) return null
  if (tryParse(trimmed)) return trimmed

  // Tier 2: Strip markdown code fences
  const unfenced = stripMarkdownFences(trimmed)
  if (unfenced !== trimmed && tryParse(unfenced)) return unfenced

  // Tier 3: Fix trailing commas (on unfenced text if fences were stripped)
  const candidate = unfenced !== trimmed ? unfenced : trimmed
  const detrailed = fixTrailingCommas(candidate)
  if (detrailed !== candidate && tryParse(detrailed)) return detrailed

  // Tier 4: Extract JSON by bracket boundaries
  const extracted = extractByBrackets(trimmed)
  if (extracted !== null && tryParse(extracted)) return extracted

  // Tier 5: Bracket extraction + trailing comma fix
  if (extracted !== null) {
    const extractedDetrailed = fixTrailingCommas(extracted)
    if (tryParse(extractedDetrailed)) return extractedDetrailed
  }

  return null
}

// ── Internal helpers ───────────────────────────────────────────────

/** Regex matching ```json ... ``` or ``` ... ``` fences. */
const MARKDOWN_FENCE_RE = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n```\s*$/

function stripMarkdownFences(text: string): string {
  const match = MARKDOWN_FENCE_RE.exec(text)
  return match ? match[1]!.trim() : text
}

/** Remove trailing commas before `}` or `]`. */
const TRAILING_COMMA_RE = /,\s*([}\]])/g

function fixTrailingCommas(text: string): string {
  return text.replace(TRAILING_COMMA_RE, '$1')
}

/**
 * Find the outermost `{...}` or `[...]` in the text by counting
 * balanced brackets. Handles nested structures correctly.
 */
function extractByBrackets(text: string): string | null {
  const openChars = new Set(['{', '['])
  const closeMap: Record<string, string> = { '{': '}', '[': ']' }

  // Find first opening bracket
  let startIdx = -1
  let openChar = ''
  for (let i = 0; i < text.length; i++) {
    if (openChars.has(text[i]!)) {
      startIdx = i
      openChar = text[i]!
      break
    }
  }

  if (startIdx === -1) return null

  const expectedClose = closeMap[openChar]!
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]!

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\' && inString) {
      escaped = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === openChar) {
      depth++
    } else if (ch === expectedClose) {
      depth--
      if (depth === 0) {
        return text.slice(startIdx, i + 1)
      }
    }
  }

  return null
}

function tryParse(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}
