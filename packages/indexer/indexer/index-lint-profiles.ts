import type { IndexLintFinding, CruxLintConfidence, CruxLintMaturity, CruxLintProfile } from '@crux/core/project-index'

export type IndexLintSelectedProfile = 'off' | CruxLintProfile

export interface IndexLintSelectionOptions {
  readonly profile?: IndexLintSelectedProfile
  readonly includeSuppressed?: boolean
}

export interface IndexLintGateOptions extends IndexLintSelectionOptions {
  readonly failOn?: {
    readonly severity?: readonly IndexLintFinding['severity'][]
    readonly maturity?: readonly CruxLintMaturity[]
    readonly confidence?: readonly CruxLintConfidence[]
  }
}

const DEFAULT_PROFILE: IndexLintSelectedProfile = 'recommended'
const DEFAULT_GATE_SEVERITIES: readonly IndexLintFinding['severity'][] = ['error']
const DEFAULT_GATE_MATURITIES: readonly CruxLintMaturity[] = ['stable']
const DEFAULT_GATE_CONFIDENCE: readonly CruxLintConfidence[] = ['high', 'medium']

export function selectIndexLintFindings(
  findings: readonly IndexLintFinding[],
  options: IndexLintSelectionOptions = {},
): IndexLintFinding[] {
  const profile = options.profile ?? DEFAULT_PROFILE
  if (profile === 'off') return []
  return findings.filter((finding) => {
    if (finding.suppressed && options.includeSuppressed !== true) return false
    return finding.profiles.includes(profile)
  })
}

export function indexLintGateFailures(
  findings: readonly IndexLintFinding[],
  options: IndexLintGateOptions = {},
): IndexLintFinding[] {
  const selected = selectIndexLintFindings(findings, options)
  const severities = new Set(options.failOn?.severity ?? DEFAULT_GATE_SEVERITIES)
  const maturities = new Set(options.failOn?.maturity ?? DEFAULT_GATE_MATURITIES)
  const confidences = new Set(options.failOn?.confidence ?? DEFAULT_GATE_CONFIDENCE)

  return selected.filter(
    (finding) =>
      severities.has(finding.severity) && maturities.has(finding.maturity) && confidences.has(finding.confidence),
  )
}
