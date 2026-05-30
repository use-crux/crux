import type { CatalogDiagnostic, CatalogLintFinding, SourceLocation } from '@crux/core/catalog'
import type { CruxLintConfig } from '@crux/core'
import { knownCatalogLintRuleId } from './catalog-lint-rules'
import { selectCatalogLintFindings } from './catalog-lint-profiles'

export function applyCatalogLintConfig(input: {
  readonly findings: readonly CatalogLintFinding[]
  readonly config?: CruxLintConfig
  readonly configFile?: string
  readonly diagnostics: CatalogDiagnostic[]
}): CatalogLintFinding[] {
  const config = input.config
  const rules = config?.rules ?? {}
  const disabled = new Set<string>()
  const severityOverrides = new Map<string, CatalogLintFinding['severity']>()

  for (const [ruleId, ruleConfig] of Object.entries(rules)) {
    if (!knownCatalogLintRuleId(ruleId)) {
      input.diagnostics.push(unknownConfiguredRuleDiagnostic(ruleId, input.configFile))
      continue
    }
    if (ruleConfig.enabled === false) disabled.add(ruleId)
    if (ruleConfig.severity) severityOverrides.set(ruleId, ruleConfig.severity)
  }

  const overridden = input.findings
    .filter((finding) => !disabled.has(finding.ruleId))
    .map((finding) => {
      const severity = severityOverrides.get(finding.ruleId)
      return severity ? { ...finding, severity } : finding
    })

  return selectCatalogLintFindings(overridden, { profile: config?.profile })
}

function unknownConfiguredRuleDiagnostic(ruleId: string, configFile: string | undefined): CatalogDiagnostic {
  const source = configFile ? ({ file: configFile, line: 1, column: 1 } satisfies SourceLocation) : undefined
  return {
    id: `catalog.lint_unknown_configured_rule:${ruleId}`,
    severity: 'warning',
    code: 'catalog.lint_unknown_configured_rule',
    message: `Crux lint config references unknown rule "${ruleId}".`,
    ...(source ? { source } : {}),
    suggestedFix: 'Remove the rule override or update it to a known Crux lint rule id.',
  }
}
