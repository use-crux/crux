/** Privacy-separated finding projections for artifacts and telemetry. */

import type { SafetyFinding } from '../decision'

/** Full validated evidence allowed only in audit/artifact read models. */
export function findingPreview(
  findings: readonly SafetyFinding[] | undefined,
): { readonly findings?: readonly SafetyFinding[] } {
  return findings ? { findings } : {}
}

/** Bounded numeric finding attributes allowed in telemetry. */
export function findingCountAttributes(
  findings: readonly SafetyFinding[] | undefined,
): Readonly<{
  findingCount?: number
  matchedCategoryCount?: number
}> {
  if (!findings) return {}
  return {
    findingCount: findings.length,
    matchedCategoryCount: findings.filter(
      (finding) => finding.type === 'media_classifier_match',
    ).length,
  }
}

/** Whether a reason contains classifier evidence forbidden in telemetry. */
export function hasClassifierMatch(
  findings: readonly SafetyFinding[] | undefined,
): boolean {
  return findings?.some(
    (finding) => finding.type === 'media_classifier_match',
  ) === true
}
