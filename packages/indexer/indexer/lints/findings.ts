import type {
  IndexLintFinding,
  ProjectDefinition,
  ProjectRelation,
} from '@crux/core/project-index'
import { indexLintFinding } from './rules'
import {
  childDefinitionsByParent,
  compareFindings,
  contextRequiresInputSchema,
  coveredDefinitions,
  definitionEvidence,
  flowRequiresArgsSchema,
  hasArgsSchema,
  hasConflictPolicy,
  hasInputSchema,
  hasOutputSchema,
  hasRetentionPolicy,
  hasRoutingTargetSourceRef,
  hasSuspensionPoints,
  isRoutingChild,
  isStateResourceReadRelation,
  isStateResourceWriteRelation,
  longLivedMemoryBlocks,
  memoryIsLongLived,
  propagateFindings,
  relationEvidence,
  relationSources,
  relationsBySource,
  routingChildHasUnresolvedTarget,
  routingTargetVariable,
  schemaSourceEvidence,
  shouldRequireCoverage,
  isRoutingRoot,
  stateResourceLabel,
  suspensionPointLabels,
  targetsByRelation,
  toolOutputNeedsAdapter,
  workspaceAllowsWrites,
} from './finding-helpers'

/**
 * Evaluates all built-in index lint findings over resolved definitions and
 * relations.
 */
export function indexLintFindings(input: {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}): IndexLintFinding[] {
  const byId = new Map(input.definitions.map((definition) => [definition.id, definition]))
  const coveredDefinitionIds = coveredDefinitions(input.definitions, input.relations)
  const guardrailTargets = targetsByRelation(input.relations, 'guardrail.applies_to')
  const consensusDecisionPolicies = relationSources(input.relations, ['consensus.uses_judge', 'consensus.uses_scorer'])
  const outgoingRelations = relationsBySource(input.relations)
  const cascadeTiersByParent = childDefinitionsByParent(
    input.definitions,
    'routing.cascade.tier',
    'cascadeDefinitionId',
  )
  const findings: IndexLintFinding[] = []

  for (const definition of input.definitions) {
    if (definition.kind === 'prompt' && !hasInputSchema(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'prompt.missing_input_schema',
          key: definition.id,
          message: `Prompt "${definition.name}" does not expose an input schema in the index.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [
            definitionEvidence(definition, 'Prompt definition has no input schema'),
            ...schemaSourceEvidence(definition, 'input', 'Unresolved input schema source'),
          ],
        }),
      )
    }

    if (definition.kind === 'prompt' && !hasOutputSchema(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'prompt.missing_output_schema',
          key: definition.id,
          message: `Prompt "${definition.name}" does not expose an output schema in the index.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [
            definitionEvidence(definition, 'Prompt definition has no output schema'),
            ...schemaSourceEvidence(definition, 'output', 'Unresolved output schema source'),
          ],
        }),
      )
    }

    if (definition.kind === 'context' && contextRequiresInputSchema(definition) && !hasInputSchema(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'context.missing_input_schema',
          key: definition.id,
          message: `Dynamic context "${definition.name}" does not expose a resolved input schema in the index.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [
            definitionEvidence(definition, 'Dynamic context has no resolved input schema'),
            ...schemaSourceEvidence(definition, 'input', 'Unresolved input schema source'),
          ],
        }),
      )
    }

    if (definition.kind === 'flow' && flowRequiresArgsSchema(definition) && !hasArgsSchema(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'flow.untyped_args',
          key: definition.id,
          message: `Flow "${definition.name}" declares args that Crux cannot project as a schema.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Flow has args but no projected args schema')],
        }),
      )
    }

    if (shouldRequireCoverage(definition) && !coveredDefinitionIds.has(definition.id)) {
      findings.push(
        indexLintFinding({
          ruleId: 'definition.missing_eval_coverage',
          key: definition.id,
          message: `${definition.kind} "${definition.name}" is not covered by an eval relation or index quality join.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Definition without eval coverage')],
        }),
      )
    }

    if (definition.kind === 'tool' && !hasInputSchema(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'tool.missing_input_schema',
          key: definition.id,
          message: `Tool "${definition.name}" does not expose an input schema in the index.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Tool definition has no input schema')],
        }),
      )
    }

    if (definition.kind === 'tool' && toolOutputNeedsAdapter(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'tool.output_not_inspectable',
          key: definition.id,
          message: `Tool "${definition.name}" executes code but does not expose a model-output adapter.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Executable tool has no model-output adapter')],
        }),
      )
    }

    if (definition.kind === 'flow' && hasSuspensionPoints(definition) && !coveredDefinitionIds.has(definition.id)) {
      findings.push(
        indexLintFinding({
          ruleId: 'flow.suspension_without_coverage',
          key: definition.id,
          message: `Flow "${definition.name}" has suspension points but no eval coverage.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [
            definitionEvidence(definition, 'Flow has suspension points'),
            {
              kind: 'definition',
              label: 'Suspension points',
              definitionId: definition.id,
              source: definition.source,
              data: { suspensionPoints: suspensionPointLabels(definition) },
            },
          ],
        }),
      )
    }

    if (definition.kind === 'workspace' && workspaceAllowsWrites(definition) && !guardrailTargets.has(definition.id)) {
      findings.push(
        indexLintFinding({
          ruleId: 'workspace.write_without_guardrail',
          key: definition.id,
          message: `Workspace "${definition.name}" exposes write-capable access without a guardrail relation.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Writable workspace has no guardrail relation')],
        }),
      )
    }

    if (definition.kind === 'memory' && memoryIsLongLived(definition) && !hasRetentionPolicy(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'memory.long_lived_without_retention',
          key: definition.id,
          message: `Memory "${definition.name}" has long-lived blocks but no visible retention policy.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [
            definitionEvidence(definition, 'Long-lived memory has no retention policy'),
            {
              kind: 'definition',
              label: 'Long-lived blocks',
              definitionId: definition.id,
              source: definition.source,
              data: { blocks: longLivedMemoryBlocks(definition) },
            },
          ],
        }),
      )
    }

    if (definition.kind === 'composition.consensus' && !consensusDecisionPolicies.has(definition.id)) {
      findings.push(
        indexLintFinding({
          ruleId: 'consensus.missing_judge',
          key: definition.id,
          message: `Consensus "${definition.name}" has no visible judge or scorer.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Consensus has no visible judge or scorer')],
        }),
      )
    }

    if (isRoutingRoot(definition) && definition.metadata?.hasStableId !== true) {
      findings.push(
        indexLintFinding({
          ruleId: 'routing.missing_stable_id',
          key: definition.id,
          message: `${definition.kind} "${definition.name}" uses an indexer fallback id instead of an authored stable id.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Routing primitive has no authored stable id')],
        }),
      )
    }

    if (definition.kind === 'routing.router' && definition.metadata?.hasDefaultRoute !== true) {
      findings.push(
        indexLintFinding({
          ruleId: 'routing.router_missing_default',
          key: definition.id,
          message: `Router "${definition.name}" does not declare a default route.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [
            definitionEvidence(definition, 'Router route map has no default key'),
            {
              kind: 'definition',
              label: 'Route keys',
              definitionId: definition.id,
              source: definition.source,
              data: { routeKeys: definition.metadata?.routeKeys },
            },
          ],
        }),
      )
    }

    if (
      isRoutingChild(definition) &&
      routingChildHasUnresolvedTarget(definition, outgoingRelations.get(definition.id) ?? [])
    ) {
      findings.push(
        indexLintFinding({
          ruleId: 'routing.unresolved_target',
          key: definition.id,
          message: `${definition.kind} "${definition.name}" points at "${routingTargetVariable(definition)}" but no index-visible target was resolved.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Routing target variable has no resolved target relation')],
        }),
      )
    }

    if (definition.kind === 'routing.cascade') {
      const tiers = cascadeTiersByParent.get(definition.id) ?? []
      const unreachableTier = tiers.slice(0, -1).find((tier) => tier.metadata?.hasEvaluate !== true)
      if (unreachableTier) {
        findings.push(
          indexLintFinding({
            ruleId: 'routing.cascade_unreachable_tier',
            key: `${definition.id}:${unreachableTier.id}`,
            message: `Cascade "${definition.name}" has non-terminal tier "${unreachableTier.name}" without an evaluator.`,
            ...((unreachableTier.source ?? definition.source)
              ? { source: unreachableTier.source ?? definition.source }
              : {}),
            primaryDefinitionId: definition.id,
            relatedDefinitionIds: [definition.id, unreachableTier.id],
            evidence: [
              definitionEvidence(definition, 'Cascade contains ordered tiers'),
              definitionEvidence(unreachableTier, 'Non-terminal tier has no evaluate callback'),
            ],
          }),
        )
      }
    }
  }

  findings.push(
    ...stateResourceWriteWithoutReadFindings({
      definitions: input.definitions,
      relations: input.relations,
    }),
  )

  for (const relation of input.relations) {
    if (relation.type === 'agent.can_handoff_to') {
      const agent = byId.get(relation.from)
      const target = byId.get(relation.to)
      if (agent?.kind === 'agent' && target?.kind !== 'agent') {
        findings.push(
          indexLintFinding({
            ruleId: 'agent.unobservable_handoff',
            key: `${relation.from}:${relation.to}`,
            message: `Agent "${agent.name}" hands off to "${relation.to}" but that target is not index-visible.`,
            ...((relation.source ?? agent.source) ? { source: relation.source ?? agent.source } : {}),
            primaryDefinitionId: relation.from,
            relatedDefinitionIds: [relation.from, relation.to],
            evidence: [
              definitionEvidence(agent, 'Agent declares a handoff'),
              relationEvidence(relation, 'Handoff target is not index-visible'),
            ],
          }),
        )
      }
    }

    if (relation.type !== 'swarm.uses_blackboard') continue
    const swarm = byId.get(relation.from)
    const blackboard = byId.get(relation.to)
    if (!swarm || !blackboard || hasConflictPolicy(blackboard)) continue
    findings.push(
      indexLintFinding({
        ruleId: 'shared_blackboard_without_policy',
        key: `${relation.from}:${relation.to}`,
        message: `Swarm "${swarm.name}" shares blackboard "${blackboard.name}" without a visible conflict policy.`,
        ...((relation.source ?? swarm.source ?? blackboard.source)
          ? { source: relation.source ?? swarm.source ?? blackboard.source }
          : {}),
        primaryDefinitionId: relation.from,
        relatedDefinitionIds: [relation.from, relation.to],
        evidence: [
          definitionEvidence(swarm, 'Swarm uses shared blackboard'),
          definitionEvidence(blackboard, 'Blackboard has no visible conflict policy'),
          relationEvidence(relation, 'Shared blackboard relation'),
        ],
      }),
    )
  }

  return propagateFindings(findings, input.relations).sort(compareFindings)
}

/**
 * Finds state resources that receive writes but are never read by indexed
 * definitions.
 */
export function stateResourceWriteWithoutReadFindings(input: {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}): IndexLintFinding[] {
  const byId = new Map(input.definitions.map((definition) => [definition.id, definition]))
  const writesByTarget = new Map<string, ProjectRelation[]>()
  const readTargets = new Set<string>()

  for (const relation of input.relations) {
    if (isStateResourceReadRelation(relation)) {
      readTargets.add(relation.to)
      continue
    }
    if (!isStateResourceWriteRelation(relation)) continue
    const writes = writesByTarget.get(relation.to) ?? []
    writes.push(relation)
    writesByTarget.set(relation.to, writes)
  }

  const findings: IndexLintFinding[] = []
  for (const [targetId, writes] of writesByTarget) {
    if (readTargets.has(targetId)) continue
    const target = byId.get(targetId)
    const source = target?.source ?? writes.find((relation) => relation.source)?.source
    const finding = indexLintFinding({
      ruleId: 'resource.write_without_read',
      key: targetId,
      message: `${stateResourceLabel(targetId, target)} receives writes but has no index-visible read path.`,
      ...(source ? { source } : {}),
      primaryDefinitionId: targetId,
      relatedDefinitionIds: [targetId],
      evidence: [
        ...(target ? [definitionEvidence(target, 'State resource receives writes')] : []),
        ...writes.map((relation) => relationEvidence(relation, 'Visible write without a matching read')),
      ],
    })
    findings.push({
      ...finding,
      affectedDefinitionIds: [
        ...new Set([...(finding.affectedDefinitionIds ?? []), ...writes.map((relation) => relation.from)]),
      ].sort(),
    })
  }

  return findings
}
