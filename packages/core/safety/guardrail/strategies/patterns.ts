/**
 * Shared regex rewrite helpers for first-party guardrail strategies.
 *
 * @module
 */

import type { SafetyFinding } from '../../decision'

/** One replaceable text pattern and its safe replacement marker. */
export interface TextPattern {
  readonly type: string
  readonly pattern: RegExp
  readonly replacement: string
}

/** Rewritten value plus normalized Safety findings. */
export interface PatternRewrite {
  readonly value: string
  readonly findings: readonly SafetyFinding[]
}

/** Default platform PII patterns for the beta helper pack. */
export const PII_PATTERNS: readonly TextPattern[] = [
  {
    type: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[redacted-email]',
  },
  {
    type: 'phone',
    pattern: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g,
    replacement: '[redacted-phone]',
  },
  {
    type: 'card',
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: '[redacted-card]',
  },
  {
    type: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[redacted-ssn]',
  },
]

/** Default secret/token patterns for the beta helper pack. */
export const SECRET_PATTERNS: readonly TextPattern[] = [
  {
    type: 'authorization',
    pattern: /\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
    replacement: '[redacted-authorization]',
  },
  {
    type: 'api-key',
    pattern: /\b(?:sk|pk|rk|key|token)-[A-Za-z0-9_-]{3,}\b/g,
    replacement: '[redacted-secret]',
  },
  {
    type: 'named-secret',
    pattern: /\b(?:api[-_]?key|x[-_]?api[-_]?key|token|secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi,
    replacement: '[redacted-secret]',
  },
]

/** Replace all pattern matches with each pattern's configured marker. */
export function rewritePatterns(input: string, patterns: readonly TextPattern[]): PatternRewrite {
  let value = input
  const counts = new Map<string, number>()

  for (const item of patterns) {
    value = value.replace(item.pattern, (match) => {
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1)
      return item.replacement
    })
  }

  return {
    value,
    findings: Array.from(counts, ([type, count]) => ({ type, count })),
  }
}

/** Replace all pattern matches with coarse masked markers. */
export function maskPatterns(input: string, patterns: readonly TextPattern[]): PatternRewrite {
  let value = input
  const counts = new Map<string, number>()

  for (const item of patterns) {
    value = value.replace(item.pattern, (match) => {
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1)
      return maskMatch(item.type, match)
    })
  }

  return {
    value,
    findings: Array.from(counts, ([type, count]) => ({ type, count })),
  }
}

/** Replace all pattern matches with deterministic non-cryptographic hashes. */
export function hashPatterns(input: string, patterns: readonly TextPattern[]): PatternRewrite {
  let value = input
  const counts = new Map<string, number>()

  for (const item of patterns) {
    value = value.replace(item.pattern, (match) => {
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1)
      return `[${item.type}:${fnv1a64(match)}]`
    })
  }

  return {
    value,
    findings: Array.from(counts, ([type, count]) => ({ type, count })),
  }
}

function maskMatch(type: string, match: string): string {
  if (type === 'email') {
    const [local, domain] = match.split('@')
    const head = local?.slice(0, 1) || '*'
    return `${head}***@${domain ?? 'redacted'}`
  }
  return `[masked-${type}]`
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * prime)
  }
  return hash.toString(16).padStart(16, '0')
}
