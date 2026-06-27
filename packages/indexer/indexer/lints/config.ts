import type { IndexDiagnostic, IndexLintFinding, IndexRuleDescriptor, SourceLocation } from '@use-crux/core/project-index'
import type { CruxLintConfig } from '@use-crux/core'
import { selectIndexLintFindings } from './profiles'
import { createKnownIndexLintRuleIds } from './rule-ids'

/**
 * Applies project lint configuration to findings and records diagnostics for
 * invalid rule overrides.
 */
export function applyIndexLintConfig(input: {
  readonly findings: readonly IndexLintFinding[]
  readonly config?: CruxLintConfig
  readonly configFile?: string
  readonly diagnostics: IndexDiagnostic[]
  /** Rule descriptors visible to this lint finalization pass. */
  readonly ruleDescriptors?: readonly Pick<IndexRuleDescriptor, 'id'>[]
}): IndexLintFinding[] {
  const config = input.config
  const rules = config?.rules ?? {}
  const disabled = new Set<string>()
  const severityOverrides = new Map<string, IndexLintFinding['severity']>()
  const knownRuleIds = createKnownIndexLintRuleIds(input.ruleDescriptors)

  for (const [ruleId, ruleConfig] of Object.entries(rules)) {
    if (!knownRuleIds.has(ruleId)) {
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

  return selectIndexLintFindings(overridden, { profile: config?.profile })
}

/**
 * Creates a diagnostic for a configured lint rule id that is not registered.
 */
function unknownConfiguredRuleDiagnostic(ruleId: string, configFile: string | undefined): IndexDiagnostic {
  const source = configFile ? ({ file: configFile, line: 1, column: 1 } satisfies SourceLocation) : undefined
  return {
    id: `index.lint_unknown_configured_rule:${ruleId}`,
    severity: 'warning',
    code: 'index.lint_unknown_configured_rule',
    message: `Crux lint config references unknown rule "${ruleId}".`,
    ...(source ? { source } : {}),
    suggestedFix: 'Remove the rule override or update it to a known Crux lint rule id.',
  }
}
