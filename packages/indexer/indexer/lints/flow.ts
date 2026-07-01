import type { IndexLintFinding, ProjectDefinition } from '@use-crux/core/project-index'
import { definitionEvidence, flowStepLabels, isRecord, suspensionPointLabels } from './finding-helpers'
import { indexLintFinding } from './rules'

/** Built-in lint findings for statically visible flow authoring hazards. */
export function flowLintFindings(definition: ProjectDefinition): IndexLintFinding[] {
  if (definition.kind !== 'flow') return []
  return [
    ...duplicateStepLabelFindings(definition),
    ...duplicateSuspendNameFindings(definition),
    ...undeclaredSuspendSignalFindings(definition),
  ]
}

function duplicateStepLabelFindings(definition: ProjectDefinition): IndexLintFinding[] {
  return duplicateLabels(flowStepLabels(definition)).map(({ label, count }) =>
    indexLintFinding({
      ruleId: 'flow.duplicate_step_label',
      key: `${definition.id}:${label}`,
      message: `Flow "${definition.name}" uses step label "${label}" ${count} times. Step labels are durable replay identities, so repeated labels can return the wrong cached output.`,
      ...(definition.source ? { source: definition.source } : {}),
      primaryDefinitionId: definition.id,
      relatedDefinitionIds: [definition.id],
      evidence: [
        definitionEvidence(definition, 'Flow has repeated step labels'),
        {
          kind: 'definition',
          label: 'Duplicate step label',
          definitionId: definition.id,
          source: definition.source,
          data: { stepLabel: label, occurrences: count },
        },
      ],
    }),
  )
}

function duplicateSuspendNameFindings(definition: ProjectDefinition): IndexLintFinding[] {
  return duplicateLabels(suspensionPointLabels(definition)).map(({ label, count }) =>
    indexLintFinding({
      ruleId: 'flow.duplicate_suspend_name',
      key: `${definition.id}:${label}`,
      message: `Flow "${definition.name}" suspends on "${label}" ${count} times. Suspend names are pending-signal keys, so repeated names can make resume behavior ambiguous.`,
      ...(definition.source ? { source: definition.source } : {}),
      primaryDefinitionId: definition.id,
      relatedDefinitionIds: [definition.id],
      evidence: [
        definitionEvidence(definition, 'Flow has repeated suspend names'),
        {
          kind: 'definition',
          label: 'Duplicate suspend name',
          definitionId: definition.id,
          source: definition.source,
          data: { suspendName: label, occurrences: count },
        },
      ],
    }),
  )
}

function undeclaredSuspendSignalFindings(definition: ProjectDefinition): IndexLintFinding[] {
  const declaredSignals = declaredSignalNames(definition)
  if (!declaredSignals) return []
  const undeclared = [...new Set(suspensionPointLabels(definition).filter((label) => !declaredSignals.has(label)))]
  return undeclared.map((label) =>
    indexLintFinding({
      ruleId: 'flow.undeclared_suspend_signal',
      key: `${definition.id}:${label}`,
      message: `Flow "${definition.name}" suspends on "${label}", but that signal is not declared in the local signal map.`,
      ...(definition.source ? { source: definition.source } : {}),
      primaryDefinitionId: definition.id,
      relatedDefinitionIds: [definition.id],
      evidence: [
        definitionEvidence(definition, 'Flow suspend name is missing from the local signal map'),
        {
          kind: 'definition',
          label: 'Declared signals',
          definitionId: definition.id,
          source: definition.source,
          data: { signalNames: [...declaredSignals] },
        },
      ],
    }),
  )
}

function duplicateLabels(labels: readonly string[]): Array<{ readonly label: string; readonly count: number }> {
  const counts = new Map<string, number>()
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([label, count]) => ({ label, count }))
}

function declaredSignalNames(definition: ProjectDefinition): Set<string> | undefined {
  const signalNames = isRecord(definition.metadata) ? definition.metadata.signalNames : undefined
  if (!Array.isArray(signalNames)) return undefined
  return new Set(signalNames.filter((name): name is string => typeof name === 'string'))
}
