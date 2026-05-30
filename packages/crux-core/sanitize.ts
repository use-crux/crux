/**
 * Input sanitization utilities for prompt injection defense.
 *
 * Provides two complementary approaches:
 * - **`safe` tagged template** — explicit, per-value control with composable helpers
 * - **Auto-escape pipeline** — secure by default, all string inputs escaped before templates
 *
 * @module
 */

// ─────────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Escape XML/HTML special characters to prevent structure breakout.
 *
 * Escapes `<`, `>`, `&`, `"`, `'` — the five characters that can break
 * out of XML tag attributes or content.
 */
export function escapeXml(str: string): string {
  if (!str) return str
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Truncate a string to a maximum length.
 *
 * @param str - The string to truncate.
 * @param maxLength - Maximum character count (default: 10,000).
 * @param suffix - Appended when truncated (default: `'…'`).
 */
export function truncate(str: string, maxLength = 10_000, suffix = '…'): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - suffix.length) + suffix
}

// ─────────────────────────────────────────────────────────────────
// Branded Wrappers (for composable helpers inside `safe`)
// ─────────────────────────────────────────────────────────────────

const SAFE_BRAND = Symbol.for('karyla.safe')

interface SafeWrapper {
  readonly [SAFE_BRAND]: true
  readonly value: string
  toString(): string
  [Symbol.toPrimitive](): string
}

function isSafeWrapper(v: unknown): v is SafeWrapper {
  return v != null && typeof v === 'object' && SAFE_BRAND in v
}

function createWrapper(value: string): SafeWrapper {
  return {
    [SAFE_BRAND]: true,
    value,
    // Allow SafeWrapper to work in regular template literals (not just safe``)
    toString() {
      return value
    },
    [Symbol.toPrimitive]() {
      return value
    },
  }
}

/**
 * Mark a value to skip escaping inside a `safe` template.
 *
 * Use for trusted content that should be interpolated as-is
 * (e.g., pre-rendered HTML, system-generated content).
 *
 * @example
 * ```ts
 * safe`Document:\n${raw(trustedHtml)}`
 * ```
 */
export function raw(value: string): SafeWrapper {
  return createWrapper(value)
}

/**
 * Truncate + escape a value inside a `safe` template.
 *
 * @example
 * ```ts
 * safe`Query: ${limit(userQuery, 500)}`
 * ```
 */
export function limit(value: string, maxLength: number, suffix = '…'): SafeWrapper {
  return createWrapper(escapeXml(truncate(value, maxLength, suffix)))
}

/**
 * Escape + wrap a value in `<user-input>` delimiters inside a `safe` template.
 *
 * Delimiters make it clear to the LLM where user content starts and ends,
 * reducing the chance of instruction following from injected content.
 *
 * @example
 * ```ts
 * safe`Instruction: ${wrap(userInstruction)}`
 * // → Instruction: <user-input>escaped content</user-input>
 * ```
 */
export function wrap(value: string, tag = 'user-input'): SafeWrapper {
  return createWrapper(`<${tag}>${escapeXml(value)}</${tag}>`)
}

// ─────────────────────────────────────────────────────────────────
// `safe` Tagged Template
// ─────────────────────────────────────────────────────────────────

/**
 * Tagged template literal that auto-escapes interpolated values.
 *
 * Plain values are escaped with `escapeXml()`. Branded wrappers
 * from `raw()`, `limit()`, and `wrap()` apply their own logic.
 *
 * @example
 * ```ts
 * // Auto-escapes all interpolations
 * safe`<brand-voice>${input.brandVoice}</brand-voice>`
 *
 * // Mix escaped and raw content
 * safe`
 *   Document: ${raw(trustedHtml)}
 *   Query: ${limit(userQuery, 500)}
 *   Instruction: ${wrap(userInstruction)}
 * `
 * ```
 */
export function safe(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = strings[0]
  for (let i = 0; i < values.length; i++) {
    const val = values[i]
    if (isSafeWrapper(val)) {
      result += val.value
    } else if (val == null) {
      result += ''
    } else {
      const str = String(val)
      if (str === '[object Object]' || str.startsWith('[object ')) {
        throw new Error(
          `safe() received a ${typeof val} that would stringify to "${str}". ` +
            `Convert to string first (e.g. JSON.stringify()), or wrap with raw() for pre-formatted content.`,
        )
      }
      result += escapeXml(str)
    }
    result += strings[i + 1]
  }
  return result
}

// ─────────────────────────────────────────────────────────────────
// Standalone Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Wrap user content in delimiters with auto-escaping.
 *
 * Standalone version of `wrap()` for use in regular template literals
 * when the `safe` tag isn't practical.
 *
 * @example
 * ```ts
 * const prompt = `Instruction: ${userContent(instruction)}`
 * // → Instruction: <user-input>escaped content</user-input>
 * ```
 */
export function userContent(content: string, tag = 'user-input'): string {
  return `<${tag}>${escapeXml(content)}</${tag}>`
}

// ─────────────────────────────────────────────────────────────────
// Dev-Time Heuristic
// ─────────────────────────────────────────────────────────────────

/** A warning about a suspicious pattern detected in input. */
export interface SuspiciousPatternWarning {
  field: string
  pattern: string
  message: string
}

/**
 * Heuristic check for common prompt injection patterns.
 *
 * Returns warnings (never throws) for patterns that look like
 * injection attempts. Not foolproof — purely a dev-time aid.
 */
export function detectSuspiciousPatterns(value: string, fieldName: string): SuspiciousPatternWarning[] {
  const warnings: SuspiciousPatternWarning[] = []

  // XML closing tag injection (e.g., </constraints>, </role>)
  if (/<\/[a-zA-Z][a-zA-Z0-9-]*>/.test(value)) {
    warnings.push({
      field: fieldName,
      pattern: 'xml-closing-tag',
      message: `Field "${fieldName}" contains XML closing tag(s) that could break prompt structure`,
    })
  }

  // "Ignore previous instructions" and variants
  const ignorePattern =
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|guidelines?|prompts?|context)/i
  if (ignorePattern.test(value)) {
    warnings.push({
      field: fieldName,
      pattern: 'instruction-override',
      message: `Field "${fieldName}" contains instruction override attempt`,
    })
  }

  // System prompt extraction
  const extractPattern =
    /(?:repeat|print|show|output|reveal|display)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|rules?)/i
  if (extractPattern.test(value)) {
    warnings.push({
      field: fieldName,
      pattern: 'prompt-extraction',
      message: `Field "${fieldName}" contains prompt extraction attempt`,
    })
  }

  return warnings
}
