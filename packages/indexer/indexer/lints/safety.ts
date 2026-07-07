import type { IndexLintFinding, ProjectDefinition } from '@use-crux/core/project-index'
import { definitionEvidence, isRecord } from './finding-helpers'
import { indexLintFinding } from './rules'

const SAFETY_POLICY_KINDS = new Set<ProjectDefinition['kind']>(['constraint', 'guardrail', 'toolPolicy'])

/** Built-in lint findings for statically visible Safety policy hazards. */
export function safetyLintFindings(definitions: readonly ProjectDefinition[]): IndexLintFinding[] {
  return duplicatePolicyIdFindings(definitions.filter(isSafetyPolicyDefinition))
}

function duplicatePolicyIdFindings(definitions: readonly ProjectDefinition[]): IndexLintFinding[] {
  const byPolicyId = new Map<string, ProjectDefinition[]>()
  for (const definition of definitions) {
    const policyId = safetyPolicyId(definition)
    const list = byPolicyId.get(policyId) ?? []
    list.push(definition)
    byPolicyId.set(policyId, list)
  }

  return [...byPolicyId.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([policyId, items]) => {
      const primary = items[0]
      return indexLintFinding({
        ruleId: 'safety.duplicate_policy_id',
        key: policyId,
        message: `Safety policy id "${policyId}" is used by ${items.length} policy definitions.`,
        ...(primary?.source ? { source: primary.source } : {}),
        primaryDefinitionId: primary?.id,
        relatedDefinitionIds: items.map((definition) => definition.id),
        evidence: items.map((definition) => definitionEvidence(definition, 'Safety policy shares this id')),
      })
    })
}

function isSafetyPolicyDefinition(definition: ProjectDefinition): boolean {
  return SAFETY_POLICY_KINDS.has(definition.kind)
}

function safetyPolicyId(definition: ProjectDefinition): string {
  const facts = isRecord(definition.metadata?.facts) ? definition.metadata.facts : undefined
  return typeof facts?.policyId === 'string' ? facts.policyId : definition.name
}
