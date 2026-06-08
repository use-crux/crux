import type { IndexLintFinding } from '@crux/core/project-index'
import { describe, expect, it } from 'vitest'
import { indexLintGateFailures, selectIndexLintFindings } from '../indexer/index-lint-profiles'

describe('index lint profiles and gates', () => {
  it('selects findings by profile without including suppressed findings by default', () => {
    const findings = [
      finding('stable-error', {
        severity: 'error',
        maturity: 'stable',
        confidence: 'high',
        profiles: ['recommended', 'strict'],
      }),
      finding('preview-warning', {
        severity: 'warning',
        maturity: 'preview',
        confidence: 'medium',
        profiles: ['recommended', 'strict'],
      }),
      finding('strict-only', { severity: 'info', maturity: 'stable', confidence: 'high', profiles: ['strict'] }),
      finding('experimental-only', {
        severity: 'warning',
        maturity: 'experimental',
        confidence: 'low',
        profiles: ['experimental'],
      }),
      finding('suppressed', {
        severity: 'error',
        maturity: 'stable',
        confidence: 'high',
        profiles: ['recommended'],
        suppressed: true,
      }),
    ]

    expect(selectIndexLintFindings(findings).map((item) => item.id)).toEqual(['stable-error', 'preview-warning'])
    expect(selectIndexLintFindings(findings, { profile: 'strict' }).map((item) => item.id)).toEqual([
      'stable-error',
      'preview-warning',
      'strict-only',
    ])
    expect(selectIndexLintFindings(findings, { profile: 'experimental' }).map((item) => item.id)).toEqual([
      'experimental-only',
    ])
    expect(selectIndexLintFindings(findings, { profile: 'off' })).toEqual([])
    expect(selectIndexLintFindings(findings, { includeSuppressed: true }).map((item) => item.id)).toEqual([
      'stable-error',
      'preview-warning',
      'suppressed',
    ])
  })

  it('returns only explicit gate failures from selected non-suppressed findings', () => {
    const findings = [
      finding('stable-error', { severity: 'error', maturity: 'stable', confidence: 'high', profiles: ['recommended'] }),
      finding('preview-error', {
        severity: 'error',
        maturity: 'preview',
        confidence: 'high',
        profiles: ['recommended'],
      }),
      finding('low-confidence', {
        severity: 'error',
        maturity: 'stable',
        confidence: 'low',
        profiles: ['recommended'],
      }),
      finding('suppressed', {
        severity: 'error',
        maturity: 'stable',
        confidence: 'high',
        profiles: ['recommended'],
        suppressed: true,
      }),
    ]

    expect(indexLintGateFailures(findings).map((item) => item.id)).toEqual(['stable-error'])
    expect(
      indexLintGateFailures(findings, {
        failOn: {
          severity: ['error'],
          maturity: ['stable', 'preview'],
          confidence: ['high', 'medium'],
        },
      }).map((item) => item.id),
    ).toEqual(['stable-error', 'preview-error'])
    expect(indexLintGateFailures(findings, { profile: 'off' })).toEqual([])
  })
})

function finding(
  id: string,
  overrides: Pick<IndexLintFinding, 'severity' | 'maturity' | 'confidence' | 'profiles'> & Partial<IndexLintFinding>,
): IndexLintFinding {
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
