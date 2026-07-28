import type { CruxObservabilityRedactionPattern } from './capture-policy-contract'

const DEFAULT_REPLACEMENT = '[REDACTED]'

interface CompiledRedactionPattern {
  readonly pattern: RegExp
  readonly replacement: string
}

const ownedSnapshots = new WeakSet<
  readonly CruxObservabilityRedactionPattern[]
>()
const compiledSnapshots = new WeakMap<
  readonly CruxObservabilityRedactionPattern[],
  readonly CompiledRedactionPattern[]
>()
const emptySnapshot = Object.freeze([] as CruxObservabilityRedactionPattern[])
ownedSnapshots.add(emptySnapshot)

/**
 * Clone redaction rules into an immutable runtime-owned snapshot.
 *
 * Owned snapshots are returned by reference so config-installed policies can
 * reuse their compiled expressions without observing caller mutation.
 */
export function normalizeObservabilityRedactionPatterns(
  patterns: readonly CruxObservabilityRedactionPattern[] | undefined,
): readonly CruxObservabilityRedactionPattern[] | undefined {
  if (patterns === undefined) return undefined
  if (!Array.isArray(patterns)) {
    throw new TypeError('observability.redactPatterns must be an array')
  }
  if (ownedSnapshots.has(patterns)) return patterns
  if (patterns.length === 0) return emptySnapshot

  const snapshot = Object.freeze(
    patterns.map((entry, index) => normalizeEntry(entry, index)),
  )
  ownedSnapshots.add(snapshot)
  validateReplacementStability(snapshot)
  return snapshot
}

function normalizeEntry(
  entry: unknown,
  index: number,
): CruxObservabilityRedactionPattern {
  if (entry instanceof RegExp) return cloneExpression(entry)
  if (typeof entry !== 'object' || entry === null) {
    throw new TypeError(
      `observability.redactPatterns[${index}] must be a RegExp or pattern object`,
    )
  }
  if (!('pattern' in entry) || !(entry.pattern instanceof RegExp)) {
    throw new TypeError(
      `observability.redactPatterns[${index}].pattern must be a RegExp`,
    )
  }
  const replacement =
    'replacement' in entry ? entry.replacement : undefined
  if (replacement !== undefined && typeof replacement !== 'string') {
    throw new TypeError(
      `observability.redactPatterns[${index}].replacement must be a string`,
    )
  }
  return Object.freeze({
    pattern: cloneExpression(entry.pattern),
    ...(replacement !== undefined ? { replacement } : {}),
  })
}

/**
 * Redact every non-empty string match in declaration order.
 *
 * Expressions are privately cloned and normalized to global, non-sticky
 * matching. The original string is returned when no rule changes it.
 */
export function redactObservabilityString(
  value: string,
  patterns: readonly CruxObservabilityRedactionPattern[] | undefined,
): string {
  const snapshot = normalizeObservabilityRedactionPatterns(patterns)
  if (!snapshot || snapshot.length === 0) return value

  return redactWithCompiledPatterns(value, compiledPatterns(snapshot))
}

function redactWithCompiledPatterns(
  value: string,
  patterns: readonly CompiledRedactionPattern[],
): string {
  let redacted = value
  for (const rule of patterns) {
    rule.pattern.lastIndex = 0
    redacted = redacted.replace(rule.pattern, (match) =>
      match.length === 0 ? match : rule.replacement,
    )
  }
  return redacted
}

function validateReplacementStability(
  snapshot: readonly CruxObservabilityRedactionPattern[],
): void {
  const compiled = compiledPatterns(snapshot)
  for (const [index, rule] of compiled.entries()) {
    if (
      redactWithCompiledPatterns(rule.replacement, compiled) !==
      rule.replacement
    ) {
      throw new TypeError(
        `observability.redactPatterns[${index}].replacement must be stable under the complete rule set`,
      )
    }
  }
}

function compiledPatterns(
  snapshot: readonly CruxObservabilityRedactionPattern[],
): readonly CompiledRedactionPattern[] {
  const cached = compiledSnapshots.get(snapshot)
  if (cached) return cached

  const compiled = Object.freeze(
    snapshot.map((entry) => {
      const pattern = entry instanceof RegExp ? entry : entry.pattern
      return Object.freeze({
        pattern: cloneExpression(pattern, globalFlags(pattern)),
        replacement:
          entry instanceof RegExp
            ? DEFAULT_REPLACEMENT
            : (entry.replacement ?? DEFAULT_REPLACEMENT),
      })
    }),
  )
  compiledSnapshots.set(snapshot, compiled)
  return compiled
}

function cloneExpression(expression: RegExp, flags = expression.flags): RegExp {
  return new RegExp(expression.source, flags)
}

function globalFlags(expression: RegExp): string {
  return `${expression.flags.replaceAll('g', '').replaceAll('y', '')}g`
}
