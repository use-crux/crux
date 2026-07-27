/** Threshold evaluation and deterministic classifier evidence formatting. */

import type { SafetyRunContext } from '../../../decision'
import type { MediaGuardrailRunResult } from '../../types'
import type { NormalizedMediaClassifierConfig } from './types'

interface MediaClassifierMatch {
  readonly category: string
  readonly score: number
  readonly threshold: number
}

/** Evaluate validated scores and emit ordered match findings. */
export function evaluateMediaClassifierScores(
  config: NormalizedMediaClassifierConfig,
  scores: Readonly<Record<string, number>>,
  ctx: SafetyRunContext,
): MediaGuardrailRunResult {
  const matches = config.categories.flatMap((category) => {
    const score = scores[category.id]
    const threshold = hasOwn(config.thresholds, category.id)
      ? config.thresholds[category.id]
      : config.threshold
    return score !== undefined && threshold !== undefined && score >= threshold
      ? [{ category: category.id, score, threshold }]
      : []
  })
  if (matches.length === 0) return { action: 'allow' }

  for (const match of matches) {
    const finding = {
      type: 'media_classifier_match',
      category: match.category,
      score: match.score,
      threshold: match.threshold,
    }
    ctx.findings.add(finding)
  }
  return {
    action: config.action,
    reason: mediaClassifierMatchReason(matches),
  }
}

function mediaClassifierMatchReason(
  matches: readonly MediaClassifierMatch[],
): string {
  const evidence = matches.map(
    (match) =>
      `${match.category} (${formatEvidenceNumber(match.score)} >= ${formatEvidenceNumber(match.threshold)})`,
  )
  return `Media classifier matched ${evidence.join(', ')}.`
}

/** Format one validated score without truncating evidence precision. */
export function formatEvidenceNumber(value: number): string {
  const formatted = String(value)
  if (formatted.includes('e') || formatted.includes('E')) return formatted
  const decimal = formatted.indexOf('.')
  if (decimal === -1) return `${formatted}.00`
  const fractionalDigits = formatted.length - decimal - 1
  return fractionalDigits >= 2
    ? formatted
    : `${formatted}${'0'.repeat(2 - fractionalDigits)}`
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
