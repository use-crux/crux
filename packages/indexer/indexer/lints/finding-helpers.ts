import type {
  IndexLintFinding,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
} from '@use-crux/core/project-index'
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

/**
 * Returns definition ids with explicit evaluation coverage.
 *
 * Coverage is derived from either `eval.covers_definition` relations or quality
 * metadata that already records linked eval/suite/experiment ids.
 */
export function coveredDefinitions(
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

/** Returns whether a definition kind participates in coverage linting. */
export function shouldRequireCoverage(definition: ProjectDefinition): boolean {
  return definition.status !== 'missing' && COVERAGE_TARGET_KINDS.has(definition.kind)
}

/** Builds the set of target definition ids for one relation type. */
export function targetsByRelation(relations: readonly ProjectRelation[], type: string): Set<string> {
  return new Set(relations.filter((relation) => relation.type === type).map((relation) => relation.to))
}

/** Builds the set of source definition ids for a selected group of relation types. */
export function relationSources(relations: readonly ProjectRelation[], types: readonly string[]): Set<string> {
  const selected = new Set(types)
  return new Set(relations.filter((relation) => selected.has(relation.type)).map((relation) => relation.from))
}

/**
 * Groups relations by source definition id.
 *
 * The returned map and arrays are newly allocated so lint rules can safely add
 * derived data without mutating caller-owned arrays.
 */
export function relationsBySource(relations: readonly ProjectRelation[]): Map<string, ProjectRelation[]> {
  const bySource = new Map<string, ProjectRelation[]>()
  for (const relation of relations) {
    const list = bySource.get(relation.from) ?? []
    list.push(relation)
    bySource.set(relation.from, list)
  }
  return bySource
}

/**
 * Groups child definitions by the parent id stored in metadata.
 *
 * Child lists are sorted by `tierIndex` when present, giving routing cascade
 * rules stable, deterministic traversal order.
 */
export function childDefinitionsByParent(
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

/** Reads numeric metadata with a deterministic sort fallback. */
export function numericMetadata(definition: ProjectDefinition, key: string): number {
  const value = definition.metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

/** Returns whether the definition is a top-level routing construct. */
export function isRoutingRoot(definition: ProjectDefinition): boolean {
  return (
    definition.kind === 'routing.router' ||
    definition.kind === 'routing.cascade' ||
    definition.kind === 'routing.fallback'
  )
}

/** Returns whether the definition is a routing child folded under a routing root. */
export function isRoutingChild(definition: ProjectDefinition): boolean {
  return (
    definition.kind === 'routing.router.route' ||
    definition.kind === 'routing.cascade.tier' ||
    definition.kind === 'routing.fallback.option'
  )
}

/**
 * Detects routing children that mention a target but lack resolved target
 * evidence.
 */
export function routingChildHasUnresolvedTarget(
  definition: ProjectDefinition,
  outgoingRelations: readonly ProjectRelation[],
): boolean {
  return (
    typeof routingTargetVariable(definition) === 'string' &&
    !outgoingRelations.some((relation) => relation.type.includes('.uses_')) &&
    !hasRoutingTargetSourceRef(definition)
  )
}

/** Reads the authored target variable for a routing child definition. */
export function routingTargetVariable(definition: ProjectDefinition): string | undefined {
  const target = definition.metadata?.targetVariable ?? definition.metadata?.modelVariable
  return typeof target === 'string' && target.length > 0 ? target : undefined
}

/** Returns whether semantic indexing resolved source evidence for a routing target. */
export function hasRoutingTargetSourceRef(definition: ProjectDefinition): boolean {
  return (definition.sourceRefs ?? []).some((ref) => ref.metadata?.routingTarget === true)
}

/** Classifies relations that read stateful resources. */
export function isStateResourceReadRelation(relation: ProjectRelation): boolean {
  return (
    relation.type.endsWith('.reads_memory') ||
    relation.type.endsWith('.reads_blackboard') ||
    relation.type.endsWith('.reads_workspace')
  )
}

/** Classifies relations that write stateful resources. */
export function isStateResourceWriteRelation(relation: ProjectRelation): boolean {
  return (
    relation.type.endsWith('.writes_memory') ||
    relation.type.endsWith('.writes_blackboard') ||
    relation.type.endsWith('.writes_workspace')
  )
}

/** Formats a state resource label for lint messages. */
export function stateResourceLabel(targetId: string, target: ProjectDefinition | undefined): string {
  if (!target) return `State resource "${targetId}"`
  return `${target.kind} "${target.name}"`
}

/** Returns whether a definition exposes an input/parameter schema. */
export function hasInputSchema(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  const intelligence = metadata?.intelligence
  const contract = isRecord(intelligence) ? intelligence.contract : undefined
  return (
    isRecord(metadata?.inputSchema) ||
    isRecord(metadata?.parameters) ||
    isRecord(metadata?.schema) ||
    (isRecord(contract) && isRecord(contract.inputSchema))
  )
}

/** Returns whether a definition exposes an output schema. */
export function hasOutputSchema(definition: ProjectDefinition): boolean {
  return isRecord(definition.metadata?.outputSchema)
}

/** Returns whether a flow definition exposes an args schema. */
export function hasArgsSchema(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (isRecord(metadata?.argsSchema)) return true
  const intelligence = metadata?.intelligence
  if (!isRecord(intelligence)) return false
  const contract = intelligence.contract
  return isRecord(contract) && isRecord(contract.argsSchema)
}

/** Returns whether a context has evidence that makes input schema linting relevant. */
export function contextRequiresInputSchema(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (!metadata) return false
  if (metadata.isStatic === false) return true
  return schemaSourceRefs(definition, 'input').length > 0
}

/** Returns whether a flow has authored args that should be schema-described. */
export function flowRequiresArgsSchema(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (!metadata) return false
  return metadata.hasArgs === true || hasItems(metadata.args)
}

/** Returns whether a tool needs a model-output adapter for its execute result. */
export function toolOutputNeedsAdapter(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (!metadata) return false
  return metadata.hasExecute === true && metadata.hasToModelOutput !== true
}

/** Returns whether a definition records resumable/suspending control flow. */
export function hasSuspensionPoints(definition: ProjectDefinition): boolean {
  const intelligence = definition.metadata?.intelligence
  if (!isRecord(intelligence)) return false
  const control = intelligence.control
  if (!isRecord(control)) return false
  return Array.isArray(control.suspensionPoints) && control.suspensionPoints.length > 0
}

/** Returns human-readable labels for recorded suspension points. */
export function suspensionPointLabels(definition: ProjectDefinition): string[] {
  const intelligence = definition.metadata?.intelligence
  if (!isRecord(intelligence)) return []
  const control = intelligence.control
  if (!isRecord(control) || !Array.isArray(control.suspensionPoints)) return []
  return control.suspensionPoints
    .map((point) => (isRecord(point) && typeof point.label === 'string' ? point.label : undefined))
    .filter((label): label is string => Boolean(label))
}

/** Returns whether workspace metadata grants write-like capabilities. */
export function workspaceAllowsWrites(definition: ProjectDefinition): boolean {
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

/** Returns whether a workspace definition declares a write conflict policy. */
export function hasConflictPolicy(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (!metadata) return false
  return typeof metadata.conflictPolicy === 'string' && metadata.conflictPolicy.length > 0
}

/** Returns whether a memory definition stores long-lived blocks. */
export function memoryIsLongLived(definition: ProjectDefinition): boolean {
  return longLivedMemoryBlocks(definition).length > 0
}

/** Returns whether a memory definition declares a retention/eviction policy. */
export function hasRetentionPolicy(definition: ProjectDefinition): boolean {
  const metadata = definition.metadata
  if (!metadata) return false
  return typeof metadata.evictionPolicy === 'string' && metadata.evictionPolicy.length > 0
}

/** Returns metadata blocks that represent long-lived memory content. */
export function longLivedMemoryBlocks(definition: ProjectDefinition): Array<Record<string, unknown>> {
  const blocks = definition.metadata?.blocks
  if (!Array.isArray(blocks)) return []
  return blocks.filter((block): block is Record<string, unknown> => {
    if (!isRecord(block)) return false
    if (block.hasEmbed === true) return true
    return typeof block.kind === 'string' && ['episodes', 'facts', 'procedures', 'reflections'].includes(block.kind)
  })
}

/** Type-safe non-empty array predicate for unknown metadata fields. */
export function hasItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

/** Narrows unknown metadata into a plain object record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** Returns schema source references for a specific authored property. */
export function schemaSourceRefs(definition: ProjectDefinition, property: string) {
  return (definition.sourceRefs ?? []).filter((ref) => ref.role === 'schema' && ref.property === property)
}

/** Builds lint evidence entries from schema source references. */
export function schemaSourceEvidence(
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

/**
 * Propagates direct lint findings upstream through composition/injection edges.
 *
 * The traversal is bounded and returns fresh finding objects, allowing callers
 * to surface architectural blast radius without mutating the original finding
 * list.
 */
export function propagateFindings(
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

/** Stable sort comparator for lint findings. */
export function compareFindings(a: IndexLintFinding, b: IndexLintFinding): number {
  return a.ruleId.localeCompare(b.ruleId) || a.id.localeCompare(b.id)
}

/** Builds evidence that points at a definition and its source location. */
export function definitionEvidence(definition: ProjectDefinition, label: string): IndexLintFinding['evidence'][number] {
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

/** Builds evidence that points at a relation and its source location. */
export function relationEvidence(relation: ProjectRelation, label: string): IndexLintFinding['evidence'][number] {
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
