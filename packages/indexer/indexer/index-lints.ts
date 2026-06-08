import type {
  IndexLintFinding,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
} from '@crux/core/project-index'
import { indexLintFinding } from './index-lint-rules'

const COVERAGE_TARGET_KINDS = new Set<ProjectDefinitionKind>([
  'prompt',
  'agent',
  'flow',
  'rag.pipeline',
  'composition.parallel',
  'composition.pipeline',
  'composition.swarm',
  'composition.consensus',
  'routing.router',
  'routing.cascade',
  'routing.fallback',
])

const PROPAGATING_RELATION_TYPES = new Set([
  'prompt.uses_context',
  'agent.uses_prompt',
  'agent.uses_tool',
  'agent.can_handoff_to',
  'flow.includes_step',
  'flow.step.uses_agent',
  'flow.step.uses_tool',
  'flow.step.uses_prompt',
  'flow.step.uses_memory',
  'flow.step.uses_blackboard',
  'composition.uses_agent',
  'composition.uses_flow',
  'composition.uses_prompt',
  'composition.uses_tool',
  'parallel.includes_branch',
  'parallel.branch.uses_agent',
  'parallel.branch.uses_flow',
  'parallel.branch.uses_prompt',
  'parallel.branch.uses_tool',
  'pipeline.includes_stage',
  'pipeline.stage.uses_agent',
  'pipeline.stage.uses_flow',
  'pipeline.stage.uses_prompt',
  'pipeline.stage.uses_tool',
  'consensus.includes_agent',
  'consensus.uses_judge',
  'consensus.uses_scorer',
  'swarm.includes_agent',
  'swarm.coordinated_by',
  'swarm.uses_blackboard',
  'swarm.uses_memory',
  'memory.includes_block',
  'memory.uses_store',
  'blackboard.uses_store',
  'workspace.exposes_tool',
  'router.includes_route',
  'router.route.uses_router',
  'router.route.uses_cascade',
  'router.route.uses_fallback',
  'router.route.uses_agent',
  'router.route.uses_prompt',
  'cascade.includes_tier',
  'cascade.tier.uses_router',
  'cascade.tier.uses_cascade',
  'cascade.tier.uses_fallback',
  'cascade.tier.uses_agent',
  'cascade.tier.uses_prompt',
  'fallback.includes_option',
  'fallback.option.uses_router',
  'fallback.option.uses_cascade',
  'fallback.option.uses_fallback',
  'fallback.option.uses_agent',
  'fallback.option.uses_prompt',
  'agent.uses_routing',
  'flow.step.uses_routing',
  'composition.uses_routing',
  'parallel.branch.uses_routing',
  'pipeline.stage.uses_routing',
])

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

function coveredDefinitions(
  definitions: readonly ProjectDefinition[],
  relations: readonly ProjectRelation[],
): Set<string> {
  const covered = new Set(
    relations.filter((relation) => relation.type === 'eval.covers_definition').map((relation) => relation.to),
  )
  for (const definition of definitions) {
    const quality = definition.quality
    if (!quality) continue
    const hasCoverage =
      hasItems(quality.evalIds) ||
      hasItems(quality.affectedEvalIds) ||
      hasItems(quality.suiteIds) ||
      hasItems(quality.affectedSuiteIds) ||
      hasItems(quality.experimentIds) ||
      hasItems(quality.baselineIds)
    if (hasCoverage) covered.add(definition.id)
  }
  return covered
}

function shouldRequireCoverage(definition: ProjectDefinition): boolean {
  return definition.status !== 'missing' && COVERAGE_TARGET_KINDS.has(definition.kind)
}

function targetsByRelation(relations: readonly ProjectRelation[], type: string): Set<string> {
  return new Set(relations.filter((relation) => relation.type === type).map((relation) => relation.to))
}

function relationSources(relations: readonly ProjectRelation[], types: readonly string[]): Set<string> {
  const selected = new Set(types)
  return new Set(relations.filter((relation) => selected.has(relation.type)).map((relation) => relation.from))
}

function relationsBySource(relations: readonly ProjectRelation[]): Map<string, ProjectRelation[]> {
  const bySource = new Map<string, ProjectRelation[]>()
  for (const relation of relations) {
    const list = bySource.get(relation.from) ?? []
    list.push(relation)
    bySource.set(relation.from, list)
  }
  return bySource
}

function childDefinitionsByParent(
  definitions: readonly ProjectDefinition[],
  kind: ProjectDefinitionKind,
  metadataKey: string,
): Map<string, ProjectDefinition[]> {
  const byParent = new Map<string, ProjectDefinition[]>()
  for (const definition of definitions) {
    if (definition.kind !== kind) continue
    const parentId = definition.metadata?.[metadataKey]
    if (typeof parentId !== 'string' || parentId.length === 0) continue
    const list = byParent.get(parentId) ?? []
    list.push(definition)
    byParent.set(parentId, list)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => numericMetadata(a, 'tierIndex') - numericMetadata(b, 'tierIndex'))
  }
  return byParent
}

function numericMetadata(definition: ProjectDefinition, key: string): number {
  const value = definition.metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

function isRoutingRoot(definition: ProjectDefinition): boolean {
  return (
    definition.kind === 'routing.router' ||
    definition.kind === 'routing.cascade' ||
    definition.kind === 'routing.fallback'
  )
}

function isRoutingChild(definition: ProjectDefinition): boolean {
  return (
    definition.kind === 'routing.router.route' ||
    definition.kind === 'routing.cascade.tier' ||
    definition.kind === 'routing.fallback.option'
  )
}

function routingChildHasUnresolvedTarget(
  definition: ProjectDefinition,
  outgoingRelations: readonly ProjectRelation[],
): boolean {
  return (
    typeof routingTargetVariable(definition) === 'string' &&
    !outgoingRelations.some((relation) => relation.type.includes('.uses_')) &&
    !hasRoutingTargetSourceRef(definition)
  )
}

function routingTargetVariable(definition: ProjectDefinition): string | undefined {
  const target = definition.metadata?.targetVariable ?? definition.metadata?.modelVariable
  return typeof target === 'string' && target.length > 0 ? target : undefined
}

function hasRoutingTargetSourceRef(definition: ProjectDefinition): boolean {
  return (definition.sourceRefs ?? []).some((ref) => ref.metadata?.routingTarget === true)
}

function isStateResourceReadRelation(relation: ProjectRelation): boolean {
  return (
    relation.type.endsWith('.reads_memory') ||
    relation.type.endsWith('.reads_blackboard') ||
    relation.type.endsWith('.reads_workspace')
  )
}

function isStateResourceWriteRelation(relation: ProjectRelation): boolean {
  return (
    relation.type.endsWith('.writes_memory') ||
    relation.type.endsWith('.writes_blackboard') ||
    relation.type.endsWith('.writes_workspace')
  )
}

function stateResourceLabel(targetId: string, target: ProjectDefinition | undefined): string {
  if (!target) return `State resource "${targetId}"`
  return `${target.kind} "${target.name}"`
}

function hasInputSchema(definition: ProjectDefinition): boolean {
  return (
    isRecord(definition.metadata?.inputSchema) ||
    isRecord(definition.metadata?.parameters) ||
    isRecord(definition.metadata?.schema)
  )
}

function hasOutputSchema(definition: ProjectDefinition): boolean {
  return isRecord(definition.metadata?.outputSchema)
}

function hasArgsSchema(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (isRecord(metadata?.argsSchema)) return true
  const intelligence = metadata?.intelligence
  if (!isRecord(intelligence)) return false
  const contract = intelligence.contract
  return isRecord(contract) && isRecord(contract.argsSchema)
}

function contextRequiresInputSchema(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (!metadata) return false
  if (metadata.isStatic === false) return true
  return schemaSourceRefs(definition, 'input').length > 0
}

function flowRequiresArgsSchema(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (!metadata) return false
  return metadata.hasArgs === true || hasItems(metadata.args)
}

function toolOutputNeedsAdapter(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (!metadata) return false
  return metadata.hasExecute === true && metadata.hasToModelOutput !== true
}

function hasSuspensionPoints(definition: ProjectDefinition): boolean {
  const intelligence = definition.metadata?.intelligence
  if (!isRecord(intelligence)) return false
  const control = intelligence.control
  if (!isRecord(control)) return false
  return Array.isArray(control.suspensionPoints) && control.suspensionPoints.length > 0
}

function suspensionPointLabels(definition: ProjectDefinition): string[] {
  const intelligence = definition.metadata?.intelligence
  if (!isRecord(intelligence)) return []
  const control = intelligence.control
  if (!isRecord(control) || !Array.isArray(control.suspensionPoints)) return []
  return control.suspensionPoints
    .map((point) => (isRecord(point) && typeof point.label === 'string' ? point.label : undefined))
    .filter((label): label is string => Boolean(label))
}

function workspaceAllowsWrites(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (!metadata) return false
  if (metadata.hasTools === true) return true
  const mounts = metadata.mounts
  if (!Array.isArray(mounts)) return false
  return mounts.some((mount) => {
    if (!isRecord(mount)) return false
    const access = typeof mount.access === 'string' ? mount.access : typeof mount.mode === 'string' ? mount.mode : ''
    return /write|edit|delete|rw|readwrite/.test(access.toLowerCase())
  })
}

function hasConflictPolicy(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (!metadata) return false
  return typeof metadata.conflictPolicy === 'string' && metadata.conflictPolicy.length > 0
}

function memoryIsLongLived(definition: ProjectDefinition): boolean {
  return longLivedMemoryBlocks(definition).length > 0
}

function hasRetentionPolicy(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (!metadata) return false
  return typeof metadata.evictionPolicy === 'string' && metadata.evictionPolicy.length > 0
}

function longLivedMemoryBlocks(definition: ProjectDefinition): Array<Record<string, unknown>> {
  const blocks = definition.metadata?.blocks
  if (!Array.isArray(blocks)) return []
  return blocks.filter((block): block is Record<string, unknown> => {
    if (!isRecord(block)) return false
    if (block.hasEmbed === true) return true
    return typeof block.kind === 'string' && ['episodes', 'facts', 'procedures', 'reflections'].includes(block.kind)
  })
}

function hasItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function schemaSourceRefs(definition: ProjectDefinition, property: string) {
  return (definition.sourceRefs ?? []).filter((ref) => ref.role === 'schema' && ref.property === property)
}

function schemaSourceEvidence(
  definition: ProjectDefinition,
  property: string,
  label: string,
): IndexLintFinding['evidence'] {
  return schemaSourceRefs(definition, property).map((ref) => ({
    kind: 'source',
    label,
    source: ref.source,
    data: {
      role: ref.role,
      property: ref.property,
      symbol: ref.symbol,
      fidelity: ref.fidelity,
      parsedSchema: ref.metadata?.parsedSchema,
      schemaKind: ref.metadata?.schemaKind,
      definitionId: definition.id,
    },
  }))
}

function propagateFindings(
  findings: readonly IndexLintFinding[],
  relations: readonly ProjectRelation[],
): IndexLintFinding[] {
  const incoming = new Map<string, ProjectRelation[]>()
  for (const relation of relations) {
    if (!PROPAGATING_RELATION_TYPES.has(relation.type)) continue
    const list = incoming.get(relation.to) ?? []
    list.push(relation)
    incoming.set(relation.to, list)
  }

  return findings.map((finding) => {
    const root = finding.primaryDefinitionId ?? finding.relatedDefinitionIds?.[0]
    if (!root) return finding
    const direct = new Set(finding.relatedDefinitionIds ?? [])
    const visited = new Set([root, ...direct])
    const queue: Array<{ definitionId: string; relationTypes: string[] }> = [{ definitionId: root, relationTypes: [] }]
    const propagated = new Set<string>()
    const paths: Array<{ fromDefinitionId: string; toDefinitionId: string; relationTypes: string[] }> = []
    const maxVisited = 100

    while (queue.length > 0 && visited.size < maxVisited) {
      const current = queue.shift()
      if (!current) break
      for (const relation of incoming.get(current.definitionId) ?? []) {
        if (visited.has(relation.from)) continue
        const relationTypes = [...current.relationTypes, relation.type]
        visited.add(relation.from)
        propagated.add(relation.from)
        paths.push({
          fromDefinitionId: relation.from,
          toDefinitionId: root,
          relationTypes,
        })
        queue.push({ definitionId: relation.from, relationTypes })
      }
    }

    if (propagated.size === 0) return finding
    const affectedDefinitionIds = [...new Set([...(finding.affectedDefinitionIds ?? []), ...propagated])].sort()
    return {
      ...finding,
      affectedDefinitionIds,
      propagatedDefinitionIds: [...propagated].sort(),
      propagationPaths: paths.sort((a, b) => a.fromDefinitionId.localeCompare(b.fromDefinitionId)),
    }
  })
}

function compareFindings(a: IndexLintFinding, b: IndexLintFinding): number {
  return a.ruleId.localeCompare(b.ruleId) || a.id.localeCompare(b.id)
}

function definitionEvidence(definition: ProjectDefinition, label: string): IndexLintFinding['evidence'][number] {
  return {
    kind: 'definition',
    label,
    definitionId: definition.id,
    ...(definition.source ? { source: definition.source } : {}),
    data: {
      kind: definition.kind,
      name: definition.name,
      fidelity: definition.fidelity,
    },
  }
}

function relationEvidence(relation: ProjectRelation, label: string): IndexLintFinding['evidence'][number] {
  return {
    kind: 'relation',
    label,
    relationId: relation.id,
    ...(relation.source ? { source: relation.source } : {}),
    data: {
      type: relation.type,
      from: relation.from,
      to: relation.to,
      fidelity: relation.fidelity,
    },
  }
}
