import type { CatalogLintFinding } from '@crux/core/catalog'
import { describe, expect, it } from 'vitest'
import { catalogLintGateFailures, selectCatalogLintFindings } from '../indexer/catalog-lint-profiles'

describe('catalog lint profiles and gates', () => {
  it('selects findings by profile without including suppressed findings by default', () => {
    const findings = [
      finding('stable-error', { severity: 'error', maturity: 'stable', confidence: 'high', profiles: ['recommended', 'strict'] }),
      finding('preview-warning', { severity: 'warning', maturity: 'preview', confidence: 'medium', profiles: ['recommended', 'strict'] }),
      finding('strict-only', { severity: 'info', maturity: 'stable', confidence: 'high', profiles: ['strict'] }),
      finding('experimental-only', { severity: 'warning', maturity: 'experimental', confidence: 'low', profiles: ['experimental'] }),
      finding('suppressed', { severity: 'error', maturity: 'stable', confidence: 'high', profiles: ['recommended'], suppressed: true }),
    ]

    expect(selectCatalogLintFindings(findings).map((item) => item.id)).toEqual(['stable-error', 'preview-warning'])
    expect(selectCatalogLintFindings(findings, { profile: 'strict' }).map((item) => item.id)).toEqual([
      'stable-error',
      'preview-warning',
      'strict-only',
    ])
    expect(selectCatalogLintFindings(findings, { profile: 'experimental' }).map((item) => item.id)).toEqual(['experimental-only'])
    expect(selectCatalogLintFindings(findings, { profile: 'off' })).toEqual([])
    expect(selectCatalogLintFindings(findings, { includeSuppressed: true }).map((item) => item.id)).toEqual([
      'stable-error',
      'preview-warning',
      'suppressed',
    ])
  })

  it('returns only explicit gate failures from selected non-suppressed findings', () => {
    const findings = [
      finding('stable-error', { severity: 'error', maturity: 'stable', confidence: 'high', profiles: ['recommended'] }),
      finding('preview-error', { severity: 'error', maturity: 'preview', confidence: 'high', profiles: ['recommended'] }),
      finding('low-confidence', { severity: 'error', maturity: 'stable', confidence: 'low', profiles: ['recommended'] }),
      finding('suppressed', { severity: 'error', maturity: 'stable', confidence: 'high', profiles: ['recommended'], suppressed: true }),
    ]

    expect(catalogLintGateFailures(findings).map((item) => item.id)).toEqual(['stable-error'])
    expect(catalogLintGateFailures(findings, {
      failOn: {
        severity: ['error'],
        maturity: ['stable', 'preview'],
        confidence: ['high', 'medium'],
      },
    }).map((item) => item.id)).toEqual(['stable-error', 'preview-error'])
    expect(catalogLintGateFailures(findings, { profile: 'off' })).toEqual([])
  })
})

function finding(
  id: string,
  overrides: Pick<CatalogLintFinding, 'severity' | 'maturity' | 'confidence' | 'profiles'> & Partial<CatalogLintFinding>,
): CatalogLintFinding {
  return {
    id,
    ruleId: `rule.${id}`,
    category: 'contracts',
    title: id,
    message: id,
    rationale: id,
    relatedDefinitionIds: [],
    evidence: [],
    fixes: [],
    docsUrl: `/docs/${id}`,
    ...overrides,
  }
}
