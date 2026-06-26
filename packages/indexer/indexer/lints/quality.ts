import type { IndexLintFinding, ProjectDefinition } from '@crux/core/project-index'
import { hasItems } from './finding-helpers'
import { indexLintFinding } from './rules'

/**
 * Builds the baseline quality finding for definitions that have experiment
 * history but no promoted baseline.
 *
 * The evidence shape mirrors native Static Index finalization exactly so the
 * native AST beta gate can compare full lint payloads instead of rule counts.
 */
export function qualityMissingBaselineFinding(definition: ProjectDefinition): IndexLintFinding | undefined {
  const quality = definition.quality
  if (!quality || !hasItems(quality.experimentIds) || hasItems(quality.baselineIds)) return undefined
  return indexLintFinding({
    ruleId: 'quality.missing_baseline',
    key: definition.id,
    message: `${definition.name} has experiment history but no promoted baseline.`,
    ...(definition.source ? { source: definition.source } : {}),
    primaryDefinitionId: definition.id,
    relatedDefinitionIds: [definition.id],
    evidence: [qualityBaselineEvidence(definition)],
  })
}

function qualityBaselineEvidence(definition: ProjectDefinition): IndexLintFinding['evidence'][number] {
  const quality = definition.quality
  const data: Record<string, unknown> = {
    experimentIds: quality?.experimentIds ?? [],
    experimentCount: quality?.experimentCount ?? 0,
  }
  if (quality?.passRate !== undefined) data.passRate = quality.passRate
  if (quality?.lastRunId !== undefined) data.lastRunId = quality.lastRunId
  return {
    kind: 'quality',
    label: 'Experiment history without baseline',
    description: 'This definition has completed experiment data but no baseline quality record.',
    definitionId: definition.id,
    source: definition.source,
    data,
  }
}
