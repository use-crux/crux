import type {
  CatalogLintFinding,
  CruxLintConfidence,
  CruxLintMaturity,
  CruxLintProfile,
} from '@crux/core/catalog'

export type CatalogLintSelectedProfile = 'off' | CruxLintProfile

export interface CatalogLintSelectionOptions {
  readonly profile?: CatalogLintSelectedProfile
  readonly includeSuppressed?: boolean
}

export interface CatalogLintGateOptions extends CatalogLintSelectionOptions {
  readonly failOn?: {
    readonly severity?: readonly CatalogLintFinding['severity'][]
    readonly maturity?: readonly CruxLintMaturity[]
    readonly confidence?: readonly CruxLintConfidence[]
  }
}

const DEFAULT_PROFILE: CatalogLintSelectedProfile = 'recommended'
const DEFAULT_GATE_SEVERITIES: readonly CatalogLintFinding['severity'][] = ['error']
const DEFAULT_GATE_MATURITIES: readonly CruxLintMaturity[] = ['stable']
const DEFAULT_GATE_CONFIDENCE: readonly CruxLintConfidence[] = ['high', 'medium']

export function selectCatalogLintFindings(
  findings: readonly CatalogLintFinding[],
  options: CatalogLintSelectionOptions = {},
): CatalogLintFinding[] {
  const profile = options.profile ?? DEFAULT_PROFILE
  if (profile === 'off') return []
  return findings.filter((finding) => {
    if (finding.suppressed && options.includeSuppressed !== true) return false
    return finding.profiles.includes(profile)
  })
}

export function catalogLintGateFailures(
  findings: readonly CatalogLintFinding[],
  options: CatalogLintGateOptions = {},
): CatalogLintFinding[] {
  const selected = selectCatalogLintFindings(findings, options)
  const severities = new Set(options.failOn?.severity ?? DEFAULT_GATE_SEVERITIES)
  const maturities = new Set(options.failOn?.maturity ?? DEFAULT_GATE_MATURITIES)
  const confidences = new Set(options.failOn?.confidence ?? DEFAULT_GATE_CONFIDENCE)

  return selected.filter((finding) =>
    severities.has(finding.severity) &&
    maturities.has(finding.maturity) &&
    confidences.has(finding.confidence),
  )
}
