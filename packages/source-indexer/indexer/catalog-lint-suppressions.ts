import { readFileSync } from 'node:fs'
import type { CatalogDiagnostic, CatalogLintFinding, SourceLocation } from '@crux/core/catalog'
import { knownCatalogLintRuleId, type CatalogLintRuleId } from './catalog-lint-rules'

type SuppressionScope = 'next-line' | 'line' | 'file'

interface CatalogLintSuppression {
  readonly id: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly scope: SuppressionScope
  readonly ruleId: string
  readonly reason?: string
  used: boolean
}

export function applyCatalogLintSuppressions(input: {
  readonly files: readonly string[]
  readonly findings: readonly CatalogLintFinding[]
  readonly diagnostics: CatalogDiagnostic[]
}): CatalogLintFinding[] {
  const suppressions = parseCatalogLintSuppressions(input.files)
  for (const suppression of suppressions) {
    if (!knownCatalogLintRuleId(suppression.ruleId)) {
      input.diagnostics.push(unknownRuleDiagnostic(suppression))
    }
  }

  const active = suppressions.filter((suppression): suppression is CatalogLintSuppression & { ruleId: CatalogLintRuleId } =>
    knownCatalogLintRuleId(suppression.ruleId),
  )
  const kept: CatalogLintFinding[] = []

  for (const finding of input.findings) {
    const suppression = active.find((candidate) => suppresses(candidate, finding))
    if (suppression) {
      suppression.used = true
      continue
    }
    kept.push(finding)
  }

  for (const suppression of active) {
    if (!suppression.used) input.diagnostics.push(unusedSuppressionDiagnostic(suppression))
  }

  return kept
}

function parseCatalogLintSuppressions(files: readonly string[]): CatalogLintSuppression[] {
  const suppressions: CatalogLintSuppression[] = []
  for (const file of files) {
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    lines.forEach((lineText, index) => {
      const match = /crux-lint-disable-(next-line|line|file)\s+([a-zA-Z0-9_.-]+)(?:\s+--\s*(.*))?/.exec(lineText)
      if (!match) return
      const line = index + 1
      const scope = match[1] as SuppressionScope
      const ruleId = match[2] ?? ''
      const reason = match[3]?.trim()
      suppressions.push({
        id: `${file}:${line}:${scope}:${ruleId}`,
        file,
        line,
        column: match.index + 1,
        scope,
        ruleId,
        ...(reason ? { reason } : {}),
        used: false,
      })
    })
  }
  return suppressions
}

function suppresses(suppression: CatalogLintSuppression & { ruleId: CatalogLintRuleId }, finding: CatalogLintFinding): boolean {
  if (finding.ruleId !== suppression.ruleId) return false
  if (!finding.source || finding.source.file !== suppression.file) return false
  if (suppression.scope === 'file') return true
  if (suppression.scope === 'line') return finding.source.line === suppression.line
  return finding.source.line === suppression.line + 1
}

function unknownRuleDiagnostic(suppression: CatalogLintSuppression): CatalogDiagnostic {
  return {
    id: `catalog.lint_unknown_suppression_rule:${sanitizeDiagnosticKey(suppression.id)}`,
    severity: 'warning',
    code: 'catalog.lint_unknown_suppression_rule',
    message: `Unknown Crux lint rule "${suppression.ruleId}" in suppression comment.`,
    source: suppressionSource(suppression),
    suggestedFix: 'Use a known Crux lint rule id or remove the suppression comment.',
  }
}

function unusedSuppressionDiagnostic(suppression: CatalogLintSuppression): CatalogDiagnostic {
  return {
    id: `catalog.lint_unused_suppression:${sanitizeDiagnosticKey(suppression.id)}`,
    severity: 'info',
    code: 'catalog.lint_unused_suppression',
    message: `Crux lint suppression for "${suppression.ruleId}" did not match any finding.`,
    source: suppressionSource(suppression),
    suggestedFix: 'Remove the stale suppression or move it to the finding it is intended to suppress.',
  }
}

function suppressionSource(suppression: CatalogLintSuppression): SourceLocation {
  return {
    file: suppression.file,
    line: suppression.line,
    column: suppression.column,
  }
}

function sanitizeDiagnosticKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]+/g, '-')
}
