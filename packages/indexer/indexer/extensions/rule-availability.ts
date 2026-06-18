import type { IndexDiagnostic, IndexFactKind } from '@crux/core/project-index'
import type { ExtensionRuleInput } from './runtime'
import type { IndexRule } from './types'

/**
 * Result of deciding whether a rule can run against the current evidence set.
 */
export type IndexRuleAvailability =
  | { readonly available: true }
  | {
      readonly available: false
      readonly missingFacts: readonly IndexFactKind[]
      readonly missingPhase: boolean
      readonly diagnostic: IndexDiagnostic
    }

/**
 * Determines whether a rule's declared phase and fact dependencies are
 * available in the current rule execution input.
 */
export function indexRuleAvailability(rule: IndexRule, input: ExtensionRuleInput): IndexRuleAvailability {
  const availableFacts = new Set(input.availableFacts ?? defaultAvailableRuleFacts(input))
  const missingFacts = rule.manifest.requires.filter((fact) => !availableFacts.has(fact))
  const missingPhase = !rulePhaseAvailable(rule, input)

  if (!missingPhase && missingFacts.length === 0) return { available: true }

  return {
    available: false,
    missingFacts,
    missingPhase,
    diagnostic: unavailableRuleDiagnostic(rule, missingPhase, missingFacts),
  }
}

function defaultAvailableRuleFacts(_input: ExtensionRuleInput): readonly IndexFactKind[] {
  return ['definitions', 'relations']
}

function rulePhaseAvailable(rule: IndexRule, input: ExtensionRuleInput): boolean {
  switch (rule.manifest.phase) {
    case 'syntax':
    case 'index':
      return true
    case 'semantic':
      return input.semantic !== undefined
    case 'runtime':
    case 'quality':
      return false
  }
}

function unavailableRuleDiagnostic(
  rule: IndexRule,
  missingPhase: boolean,
  missingFacts: readonly IndexFactKind[],
): IndexDiagnostic {
  const reasons = [
    ...(missingPhase ? [`phase "${rule.manifest.phase}" is unavailable`] : []),
    ...(missingFacts.length > 0 ? [`missing facts: ${missingFacts.join(', ')}`] : []),
  ]
  return {
    id: `diagnostic:index-rule-unavailable:${safeDiagnosticID(rule.manifest.id)}`,
    severity: 'info',
    code: 'index.rule_unavailable',
    message: `Rule "${rule.manifest.id}" was skipped because ${reasons.join(' and ')}.`,
    suggestedFix: 'Enable the required analysis phase or run again after the required evidence is available.',
  }
}

function safeDiagnosticID(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]+/g, '-')
}
