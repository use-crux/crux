import type {
  InjectionUseFacts,
  IndexDiagnostic,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
  ProjectRelationFidelity,
  SourceLocation,
} from '@crux/core/project-index'
import { indexRelationPolicies } from './policies'
import type { IndexRelationPolicy } from './types'
import { withExpandedInputContracts } from '../static/input-contracts'
import { factsUseEntries, relationHintForTarget, safeUseEntryId } from '../static/use-entry-helpers'
import type { StaticFoundDefinition } from '../types'

export { indexRelationPolicies } from './policies'
export type { IndexRelationPolicy, IndexRelationPresentation } from './types'

/**
 * Preserves the legacy static id contract while making relation identity independent of discovery tier.
 *
 * Static and semantic passes deliberately share ids for the same relation triple.
 * That lets later, higher-fidelity evidence replace earlier facts instead of adding
 * parallel graph edges that describe the same architecture relationship.
 */
export function staticRelationId(from: string, type: string, to: string): string {
  return resolvedRelationId(type, from, to)
}

/**
 * Encodes the relation triple as the canonical graph edge identity.
 *
 * Callers should use `relationIdentity` when they already have a relation object.
 * This lower-level helper exists for relation constructors and tests that are
 * still working from relation components.
 */
export function resolvedRelationId(type: string, from: string, to: string): string {
  return `relation:${type}:${from}:${to}`
}

/**
 * Normalizes authored relation components into a fresh Project Index relation value.
 *
 * The constructor centralizes id shape so static, semantic, patch, and test
 * producers cannot accidentally diverge. Supplying an explicit id is reserved for
 * callers that are preserving an existing relation object across a projection.
 */
export function projectRelation(input: {
  readonly type: string
  readonly from: string
  readonly to: string
  readonly fidelity: ProjectRelation['fidelity']
  readonly source?: SourceLocation
  readonly id?: string
}): ProjectRelation {
  return {
    id:
      input.id ??
      (input.fidelity === 'resolved'
        ? resolvedRelationId(input.type, input.from, input.to)
        : staticRelationId(input.from, input.type, input.to)),
    type: input.type,
    from: input.from,
    to: input.to,
    fidelity: input.fidelity,
    ...(input.source ? { source: input.source } : {}),
  }
}

/**
 * Relation policy registry with explicit precedence and non-throwing validation.
 *
 * The table makes policy precedence and lookup behavior explicit: callers get O(1)
 * `policyFor()` access, a declared use-entry matching precedence, and validation
 * diagnostics that can be surfaced in tests or compiler output instead of relying
 * on array order as an undocumented contract.
 */
export interface RelationPolicyTable {
  /** Deterministic policy order used when diagnostics or generated manifests need stable presentation. */
  readonly policies: readonly IndexRelationPolicy[]
  /**
   * Answers whether a relation type is declared in this compiler profile.
   *
   * Duplicate policy types are reported through `validation`; lookup remains stable
   * by keeping the first policy so construction is non-throwing and testable.
   */
  policyFor(type: string): IndexRelationPolicy | undefined
  /** Definition-kind priority used when one authored use entry can match multiple relation targets. */
  readonly useMatchPrecedence: readonly ProjectDefinitionKind[]
  /** Construction diagnostics such as duplicate relation types or missing precedence entries. */
  readonly validation: readonly IndexDiagnostic[]
}

/**
 * Normalizes ordered policy groups into the relation resolver's lookup contract.
 *
 * @param input.groups Policy groups in precedence order. Policies are flattened without mutation.
 * @param input.useMatchPrecedence Explicit owner-kind order for ambiguous `uses` relation binding.
 * @returns A table that preserves first-policy-wins behavior while exposing invalid configuration as diagnostics.
 */
export function createRelationPolicyTable(input: {
  readonly groups: ReadonlyArray<readonly IndexRelationPolicy[]>
  readonly useMatchPrecedence: readonly ProjectDefinitionKind[]
}): RelationPolicyTable {
  const policies = input.groups.flat()
  const byType = new Map<string, IndexRelationPolicy>()
  const validation: IndexDiagnostic[] = []
  for (const policy of policies) {
    if (byType.has(policy.type)) {
      validation.push(
        policyTableDiagnostic({
          id: `relation.policy_table_invalid:duplicate:${policy.type}`,
          message: `Duplicate relation policy for "${policy.type}".`,
          relatedDefinitionIds: [policy.type],
        }),
      )
      continue
    }
    byType.set(policy.type, policy)
  }

  const precedence = new Set(input.useMatchPrecedence)
  const useOwnerKinds = new Set(
    policies.filter((policy) => isInjectionUseRelation(policy.type)).flatMap((policy) => policy.fromKinds ?? []),
  )
  const missingPrecedence = [...useOwnerKinds].filter((kind) => !precedence.has(kind))
  if (missingPrecedence.length > 0) {
    validation.push(
      policyTableDiagnostic({
        id: `relation.policy_table_invalid:precedence:${missingPrecedence.join(',')}`,
        message: `Relation use-match precedence is missing ${missingPrecedence.join(', ')}.`,
        relatedDefinitionIds: missingPrecedence,
      }),
    )
  }

  return {
    policies,
    policyFor: (type) => byType.get(type),
    useMatchPrecedence: [...input.useMatchPrecedence],
    validation,
  }
}

/**
 * Built-in first-party relation policies used by the Crux indexer.
 *
 * This value is the default policy table for `resolveRelationModel`; tests may pass
 * a custom table to exercise policy gaps without monkey-patching module state.
 */
export const builtInRelationPolicies = createRelationPolicyTable({
  groups: [indexRelationPolicies],
  useMatchPrecedence: ['prompt', 'context', 'injectable', 'tool'],
})

/**
 * Names the semantic identity shared by static, semantic, and patch relation facts.
 *
 * Relation ids from static and semantic passes intentionally share this shape so a
 * higher-fidelity semantic edge can replace a lower-fidelity static edge without
 * changing graph identity.
 *
 * @param relation Any value containing a relation `type`, `from`, and `to` triple.
 * @returns The stable key used for relation replacement and patch phase accounting.
 */
export function relationIdentity(relation: Pick<ProjectRelation, 'type' | 'from' | 'to'>): string {
  return resolvedRelationId(relation.type, relation.from, relation.to)
}

/**
 * Merges relation groups by semantic identity instead of raw `id`.
 *
 * When two relations describe the same semantic triple, the relation with the
 * highest fidelity wins. Later relations with the same fidelity replace earlier
 * ones, which keeps semantic/project-level passes able to intentionally refine
 * static facts while preserving deterministic output order.
 *
 * @param groups Relation groups ordered from oldest/lowest-priority to newest/highest-priority.
 * @returns Identity-deduplicated relations with canonical ids.
 */
export function mergeRelationsByIdentity(...groups: ReadonlyArray<readonly ProjectRelation[]>): ProjectRelation[] {
  const byIdentity = new Map<string, ProjectRelation>()
  for (const relation of groups.flat()) {
    const identity = relationIdentity(relation)
    const current = byIdentity.get(identity)
    if (!current || relationFidelityRank(relation.fidelity) >= relationFidelityRank(current.fidelity)) {
      byIdentity.set(identity, {
        ...relation,
        id: identity,
      })
    }
  }
  return [...byIdentity.values()]
}

/** Explains why a static relation reference was conserved in the report instead of emitted as an edge. */
export type UnresolvedRelationReason =
  | 'target-not-found'
  | 'no-fallback-id'
  | 'no-policy'
  | 'kind-mismatch'
  | 'use-entry-unmatched'

/**
 * Resolver-owned view of an authored relation reference.
 *
 * This intentionally contains only stable index concepts so diagnostics and future
 * devtools views do not need to understand extractor-specific fact shapes.
 */
export interface RelationFactRef {
  /** Definition whose extracted facts introduced this relation ref. */
  readonly ownerDefinitionId: string
  /** Relation type before any target-kind specialization. */
  readonly refType: string
  /** Variable/import name used as the target, when the extractor did not know an id. */
  readonly toVariable?: string
  /** Target id supplied by the extractor; these refs should not need variable fallback. */
  readonly toId?: string
  /** Best available source anchor for diagnostics when the ref itself has no location. */
  readonly source?: SourceLocation
}

/**
 * Evidence for a missing edge that would previously have disappeared.
 *
 * `candidates` is reserved for richer matching failures where the resolver can
 * explain why nearby definitions were rejected.
 */
export interface UnresolvedRelationRef {
  /** Diagnostic category that explains which resolver invariant failed. */
  readonly reason: UnresolvedRelationReason
  /** Normalized evidence for the relation ref that failed to become an edge. */
  readonly fact: RelationFactRef
  /** Rejected targets, when the resolver had enough evidence to explain an ambiguous match. */
  readonly candidates?: readonly { readonly definitionId: string; readonly rejectedBecause: string }[]
  /** Source file override for cross-file refs whose owner location is not precise enough. */
  readonly file?: string
}

/**
 * Audit trail for relation refs that entered the resolver.
 *
 * Every static relation reference should either become a relation or appear in
 * this report. Diagnostics are derived separately so callers can adopt reporting
 * gradually without changing the resolution model.
 */
export interface RelationResolutionReport {
  /** References that did not bind to a concrete relation. */
  readonly unresolved: readonly UnresolvedRelationRef[]
  /** Relation types observed without a registered policy, grouped by type. */
  readonly policyGaps: readonly {
    readonly type: string
    readonly sampleFact: RelationFactRef
    readonly count: number
  }[]
  /** Aggregate resolver health without forcing callers to inspect every diagnostic row. */
  readonly counts: { readonly resolved: number; readonly unresolved: number; readonly policyGaps: number }
}

/**
 * Projects resolver accounting into user-visible compiler diagnostics.
 *
 * @param report Conservation and policy-gap report from `resolveRelationModel`.
 * @returns Diagnostics with stable `relation.*` codes suitable for compiler output.
 */
export function relationDiagnosticsFromReport(report: RelationResolutionReport): IndexDiagnostic[] {
  return [
    ...report.unresolved.map((entry) => ({
      id: `relation.unresolved_reference:${entry.fact.ownerDefinitionId}:${entry.fact.refType}:${entry.fact.toVariable ?? entry.fact.toId ?? 'unknown'}`,
      severity: 'warning' as const,
      code: 'relation.unresolved_reference',
      message: `Could not resolve ${entry.fact.refType} relation target: ${entry.reason}.`,
      source: entry.fact.source,
      relatedDefinitionIds: [entry.fact.ownerDefinitionId],
    })),
    ...report.policyGaps.map((gap) => ({
      id: `relation.policy_gap:${gap.type}`,
      severity: 'warning' as const,
      code: 'relation.policy_gap',
      message: `No relation policy matched ${gap.count} "${gap.type}" relation reference(s).`,
      source: gap.sampleFact.source,
      relatedDefinitionIds: [gap.sampleFact.ownerDefinitionId],
    })),
  ]
}

/**
 * Boundary value for relation resolution at file scope or project scope.
 *
 * Pass `found` at file scope when static relation references still need binding.
 * At project scope, omit `found` and pass already-resolved static, semantic, or
 * runtime relations through `relations`.
 */
export interface RelationModelInput {
  /** Static definitions whose relation refs still need binding. */
  readonly found?: readonly StaticFoundDefinition[]
  /** Imported definitions keyed by local variable/import name for file-scope binding. */
  readonly importedDefinitions?: ReadonlyMap<string, ProjectDefinition>
  /** Definitions that should receive relation-derived read-model metadata. */
  readonly definitions: readonly ProjectDefinition[]
  /** Relations already resolved elsewhere, such as config, discovery, semantic, or runtime facts. */
  readonly relations?: readonly ProjectRelation[]
}

/**
 * The relation graph plus the definition metadata derived from it.
 *
 * The model is pure data: identity-merged relations, definitions enriched from
 * those relations, and accounting for relation facts that could not be resolved.
 */
export interface RelationModel {
  /** Canonical relation set after static binding and fidelity-aware identity merge. */
  readonly relations: readonly ProjectRelation[]
  /** Input definitions projected through the relation read-model enrichment pipeline. */
  readonly definitions: readonly ProjectDefinition[]
  /** Conservation and policy-gap accounting for the resolution pass. */
  readonly report: RelationResolutionReport
}

/**
 * Resolves and projects the complete relation model for file or project scope.
 *
 * The function is pure and idempotent. When `found` is provided, static relation
 * refs are bound using local/imported definitions; the result is then merged with
 * pre-resolved relations by semantic identity and projected back onto definitions.
 * Imported definitions can inform enrichment but are not added to the returned
 * definition list unless they were present in `input.definitions`.
 *
 * @param input Definitions, optional static refs, imported targets, and pre-resolved relations.
 * @param options.policies Policy table for tests or future profile-specific resolution.
 * @returns Canonical relations, enriched definitions, and unresolved-reference accounting.
 */
export function resolveRelationModel(
  input: RelationModelInput,
  options?: { readonly policies?: RelationPolicyTable },
): RelationModel {
  const policies = options?.policies ?? builtInRelationPolicies
  const staticBinding = input.found
    ? bindStaticRelationRefs(input.found, input.importedDefinitions, policies)
    : emptyStaticRelationBinding()
  const relations = mergeRelationsByIdentity(staticBinding.relations, input.relations ?? [])
  const projectPolicyGaps = policyGapsForResolvedRelations(input.relations ?? [], policies)
  const definitionIds = new Set(input.definitions.map((definition) => definition.id))
  const importedDefinitions = [...(input.importedDefinitions?.values() ?? [])].filter(
    (definition) => !definitionIds.has(definition.id),
  )
  const definitions = withResolvedRelationReadModel([...input.definitions, ...importedDefinitions], relations).filter(
    (definition) => definitionIds.has(definition.id),
  )
  return {
    relations,
    definitions,
    report: relationReport({
      resolved: relations.length,
      unresolved: staticBinding.unresolved,
      policyGaps: mergePolicyGaps(staticBinding.policyGaps, projectPolicyGaps),
    }),
  }
}

/**
 * Applies the order-sensitive definition projections derived from relation knowledge.
 *
 * Routing target metadata must be present before injection/read-model expansion, and
 * relation dependency buckets must be present before input contracts are expanded.
 * Keeping those stages behind this single function prevents callers from compiling
 * successfully with a subtly reordered or partial read model.
 */
export function withResolvedRelationReadModel(
  definitions: readonly ProjectDefinition[],
  relations: readonly ProjectRelation[],
): ProjectDefinition[] {
  return withResolvedInjectionReadModel(withResolvedRoutingTargetMetadata(definitions, relations), relations)
}

interface StaticRelationBinding {
  /** Relations successfully produced from static relation refs. */
  readonly relations: readonly ProjectRelation[]
  /** Static refs that were examined but could not produce a relation. */
  readonly unresolved: readonly UnresolvedRelationRef[]
  /** Missing-policy groups discovered while binding static refs. */
  readonly policyGaps: readonly {
    readonly type: string
    readonly sampleFact: RelationFactRef
    readonly count: number
  }[]
}

/**
 * Mirrors resolved injection and runtime-use graph targets into definition metadata.
 *
 * Index snapshots keep canonical edges in `relations`, but UI and patch consumers
 * need target ids and dependency buckets next to authored use entries. This stage
 * never mutates caller-owned definitions, and its position in the pipeline matters.
 */
function withResolvedInjectionReadModel(
  definitions: readonly ProjectDefinition[],
  relations: readonly ProjectRelation[],
): ProjectDefinition[] {
  return withExpandedInputContracts(
    withResolvedRuntimeUseEntryTargets(
      withResolvedInjectionUseEntryTargets(withResolvedRelationDependencyFacts(definitions, relations), relations),
    ),
    relations,
  )
}

/**
 * Route child definitions expose their chosen target in metadata because detail
 * panels render children independently from the canonical edge list.
 */
function withResolvedRoutingTargetMetadata(
  definitions: readonly ProjectDefinition[],
  relations: readonly ProjectRelation[],
): ProjectDefinition[] {
  const targetByChildId = new Map<string, { targetKind: ProjectDefinitionKind; targetDefinitionId: string }>()
  for (const relation of relations) {
    const targetKind = routingTargetKindForRelation(relation.type)
    if (!targetKind) continue
    targetByChildId.set(relation.from, {
      targetKind,
      targetDefinitionId: relation.to,
    })
  }

  return definitions.map((definition) => {
    const target = targetByChildId.get(definition.id)
    if (!target) return definition
    return {
      ...definition,
      metadata: {
        ...(definition.metadata ?? {}),
        ...target,
      },
    }
  })
}

/**
 * Keeps detail-panel dependency summaries in lockstep with the canonical relation graph.
 */
function withResolvedRelationDependencyFacts(
  definitions: readonly ProjectDefinition[],
  relations: readonly ProjectRelation[],
): ProjectDefinition[] {
  const dependenciesByDefinition = new Map<string, Map<string, Set<string>>>()
  for (const relation of relations) {
    const key = dependencyKeyForRelation(relation.type)
    if (!key) continue
    const byKey = dependenciesByDefinition.get(relation.from) ?? new Map<string, Set<string>>()
    const ids = byKey.get(key) ?? new Set<string>()
    ids.add(relation.to)
    byKey.set(key, ids)
    dependenciesByDefinition.set(relation.from, byKey)
  }
  return definitions.map((definition) => {
    const resolved = dependenciesByDefinition.get(definition.id)
    if (!resolved) return definition
    const current = definition.metadata?.intelligence?.dependencies ?? {}
    const dependencies: Record<string, unknown> = { ...current }
    for (const [key, ids] of resolved) {
      const existing = Array.isArray(dependencies[key]) ? (dependencies[key] as string[]) : []
      dependencies[key] = [...new Set([...existing, ...ids])].sort()
    }
    return {
      ...definition,
      metadata: {
        ...(definition.metadata ?? {}),
        intelligence: {
          ...(definition.metadata?.intelligence ?? { confidence: 'static' }),
          dependencies,
        },
      },
    }
  })
}

/**
 * Only dependency-style injection relations are mirrored into dependency buckets.
 */
function dependencyKeyForRelation(type: string): string | undefined {
  if (!type.startsWith('prompt.') && !type.startsWith('context.') && !type.startsWith('injectable.')) return undefined
  if (type.endsWith('.uses_context')) return 'contexts'
  if (type.endsWith('.uses_injectable')) return 'injectables'
  if (type.endsWith('.uses_tool')) return 'tools'
  if (type.endsWith('.uses_memory')) return 'memory'
  if (type.endsWith('.uses_blackboard')) return 'blackboards'
  if (type.endsWith('.uses_workspace')) return 'workspaces'
  return undefined
}

/**
 * Gives authored use entries the concrete target relation they contributed to.
 */
function withResolvedInjectionUseEntryTargets(
  definitions: readonly ProjectDefinition[],
  relations: readonly ProjectRelation[],
): ProjectDefinition[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]))
  const outgoing = new Map<string, ProjectRelation[]>()
  for (const relation of relations) {
    if (!isInjectionUseRelation(relation.type)) continue
    const list = outgoing.get(relation.from) ?? []
    list.push(relation)
    outgoing.set(relation.from, list)
  }

  return definitions.map((definition) => {
    const entries = factsUseEntries(definition)
    if (entries.length === 0) return definition
    const candidates = [...(outgoing.get(definition.id) ?? [])]
    if (candidates.length === 0) return definition

    const enriched = entries.map((entry) => {
      const match = takeMatchingRelation(entry, candidates, byId)
      if (!match) return entry
      const target = byId.get(match.to)
      return {
        ...entry,
        relationHint: relationHintForTarget(target?.kind) ?? entry.relationHint,
        targetDefinitionId: match.to,
        ...(target?.kind ? { targetKind: target.kind } : {}),
        ...(target?.name ? { targetName: target.name } : {}),
        relationType: match.type,
        relationFidelity: match.fidelity,
      } satisfies InjectionUseFacts
    })

    return {
      ...definition,
      metadata: {
        ...(definition.metadata ?? {}),
        facts: {
          ...(definition.metadata?.facts ?? {}),
          useEntries: enriched,
        } as NonNullable<ProjectDefinition['metadata']>['facts'],
      },
    }
  })
}

/**
 * One relation should explain at most one authored use entry in a projection pass.
 */
function takeMatchingRelation(
  entry: InjectionUseFacts,
  candidates: ProjectRelation[],
  byId: ReadonlyMap<string, ProjectDefinition>,
): ProjectRelation | undefined {
  const index = candidates.findIndex((relation) => relationMatchesUseEntry(entry, relation, byId.get(relation.to)))
  const fallbackIndex = index >= 0 ? index : entry.variable ? -1 : 0
  if (fallbackIndex < 0) return undefined
  const [relation] = candidates.splice(fallbackIndex, 1)
  return relation
}

/**
 * Matches authored variables against all stable names a target definition may expose.
 */
function relationMatchesUseEntry(
  entry: InjectionUseFacts,
  relation: ProjectRelation,
  target: ProjectDefinition | undefined,
): boolean {
  if (!entry.variable) return false
  return (
    entry.variable === target?.name ||
    entry.variable === target?.metadata?.exportName ||
    target?.id.endsWith(`:${entry.variable}`) ||
    relation.to.endsWith(`:${safeUseEntryId(entry.variable)}`)
  )
}

/**
 * Injection-use relations are the only edges projected back onto authored use entries.
 */
function isInjectionUseRelation(type: string): boolean {
  return (
    type === 'prompt.uses_context' ||
    type === 'prompt.uses_injectable' ||
    type === 'prompt.uses_memory' ||
    type === 'prompt.uses_blackboard' ||
    type === 'context.uses_context' ||
    type === 'context.uses_injectable' ||
    type === 'context.uses_memory' ||
    type === 'context.uses_blackboard' ||
    type === 'injectable.uses_context' ||
    type === 'injectable.uses_memory' ||
    type === 'injectable.uses_blackboard'
  )
}

/**
 * Runtime `prepare` entries sometimes name ambient resources rather than imported values.
 */
function withResolvedRuntimeUseEntryTargets(definitions: readonly ProjectDefinition[]): ProjectDefinition[] {
  const runtimeTargets = definitions.filter(isRuntimeUseTarget)
  if (runtimeTargets.length === 0) return [...definitions]

  return definitions.map((definition) => {
    const entries = factsUseEntries(definition)
    if (entries.length === 0) return definition
    const enriched = entries.map((entry) => {
      if (entry.targetDefinitionId || entry.via !== 'runtime') return entry
      const target = runtimeUseEntryTarget(entry, runtimeTargets)
      if (!target) return entry
      return {
        ...entry,
        relationHint: relationHintForTarget(target.kind) ?? entry.relationHint,
        targetDefinitionId: target.id,
        targetKind: target.kind,
        targetName: target.name,
        relationType: runtimeUseRelationType(definition.kind, target.kind),
        relationFidelity: 'partial',
      } satisfies InjectionUseFacts
    })
    if (enriched.every((entry, index) => entry === entries[index])) return definition
    return {
      ...definition,
      metadata: {
        ...(definition.metadata ?? {}),
        facts: {
          ...(definition.metadata?.facts ?? {}),
          useEntries: enriched,
        } as NonNullable<ProjectDefinition['metadata']>['facts'],
      },
    }
  })
}

/**
 * Runtime use entries can only target definitions that are safe ambient resources.
 */
function isRuntimeUseTarget(definition: ProjectDefinition): boolean {
  return (
    definition.kind === 'memory' ||
    definition.kind === 'blackboard' ||
    definition.kind === 'rag.retriever' ||
    (definition.kind === 'context' && definitionHasToolFacts(definition))
  )
}

/**
 * Tool-context definitions are identified from normalized static facts, not naming alone.
 */
function definitionHasToolFacts(definition: ProjectDefinition): boolean {
  const facts = definition.metadata?.facts
  if (!facts || typeof facts !== 'object' || !('tools' in facts)) return false
  const tools = (facts as { tools?: { hasTools?: unknown } }).tools
  return tools?.hasTools === true
}

/**
 * Resolves runtime aliases such as `tools`, `x.memory`, and `blackboard`.
 */
function runtimeUseEntryTarget(
  entry: InjectionUseFacts,
  runtimeTargets: readonly ProjectDefinition[],
): ProjectDefinition | undefined {
  if (!entry.variable) return undefined
  const variable = entry.variable
  if (variable === 'tools') {
    return (
      runtimeTargets.find(
        (definition) => definition.id === 'context:karyla-tools' || definition.name === 'karyla-tools',
      ) ?? runtimeTargets.find((definition) => definition.id.endsWith(':tools'))
    )
  }

  if (variable.endsWith('.tools')) {
    const owner = variable.slice(0, -'.tools'.length)
    const safeOwner = safeUseEntryId(owner).toLowerCase()
    return (
      runtimeTargets.find(
        (definition) => definition.id.endsWith(':tools') && definition.id.toLowerCase().includes(safeOwner),
      ) ?? runtimeTargets.find((definition) => definition.id.endsWith(':tools'))
    )
  }

  if (variable.endsWith('.memory')) {
    const owner = variable.slice(0, -'.memory'.length)
    const safeOwner = safeUseEntryId(owner).toLowerCase()
    const aliases = runtimeMemoryOwnerAliases(safeOwner)
    return runtimeTargets.find(
      (definition) =>
        definition.kind === 'memory' &&
        aliases.some(
          (alias) =>
            definition.id.endsWith(`:${alias}`) ||
            definition.id.toLowerCase().includes(alias) ||
            definition.name.toLowerCase().includes(alias),
        ),
    )
  }

  if (variable.endsWith('.retriever')) {
    const owner = variable.slice(0, -'.retriever'.length)
    const safeOwner = safeUseEntryId(owner).toLowerCase()
    return runtimeTargets.find(
      (definition) =>
        definition.kind === 'rag.retriever' &&
        (definition.id.endsWith(`:${safeOwner}`) ||
          definition.id.toLowerCase().includes(safeOwner) ||
          definition.name.toLowerCase().includes(safeOwner)),
    )
  }

  if (variable === 'blackboard') {
    return (
      runtimeTargets.find(
        (definition) => definition.kind === 'blackboard' && definition.metadata?.exportName === 'blackboard',
      ) ??
      runtimeTargets.find(
        (definition) =>
          definition.kind === 'blackboard' &&
          typeof definition.metadata?.facts === 'object' &&
          definition.metadata.facts !== null &&
          'runtimeIdPrefix' in definition.metadata.facts &&
          (definition.metadata.facts as { runtimeIdPrefix?: unknown }).runtimeIdPrefix === 'thread:',
      ) ??
      runtimeTargets.find((definition) => definition.kind === 'blackboard')
    )
  }

  const direct = runtimeTargets.find(
    (definition) =>
      variable === definition.name ||
      variable === definition.metadata?.exportName ||
      definition.id.endsWith(`:${safeUseEntryId(variable)}`),
  )
  if (direct) return direct

  return undefined
}

/**
 * Runtime use-entry matches produce partial graph knowledge until semantic analysis confirms them.
 */
function runtimeUseRelationType(ownerKind: ProjectDefinitionKind, targetKind: ProjectDefinitionKind): string {
  if (targetKind === 'memory') return `${ownerKind}.uses_memory`
  if (targetKind === 'blackboard') return `${ownerKind}.uses_blackboard`
  if (targetKind === 'injectable') return `${ownerKind}.uses_injectable`
  return `${ownerKind}.uses_context`
}

/**
 * Keeps historical runtime memory aliases compatible with current index ids.
 */
function runtimeMemoryOwnerAliases(owner: string): string[] {
  if (owner === 'episodic') return ['episodic', 'episodes', 'user-episodes']
  return [owner]
}

/**
 * Routing relation names encode the target definition kind in their suffix.
 */
function routingTargetKindForRelation(type: string): ProjectDefinitionKind | undefined {
  if (!isRoutingTargetRelation(type)) return undefined
  if (type.endsWith('.uses_router')) return 'routing.router'
  if (type.endsWith('.uses_cascade')) return 'routing.cascade'
  if (type.endsWith('.uses_fallback')) return 'routing.fallback'
  if (type.endsWith('.uses_agent')) return 'agent'
  if (type.endsWith('.uses_prompt')) return 'prompt'
  return undefined
}

/**
 * Routing target metadata is only valid for folded routing child definitions.
 */
function isRoutingTargetRelation(type: string): boolean {
  return (
    type.startsWith('router.route.uses_') ||
    type.startsWith('cascade.tier.uses_') ||
    type.startsWith('fallback.option.uses_')
  )
}

/**
 * Binds extractor-emitted static relation refs into concrete Project Index relations.
 *
 * The binder conserves every ref: successful refs append a relation, while failed
 * refs append an unresolved report entry with a reason that can become a diagnostic.
 */
function bindStaticRelationRefs(
  found: readonly StaticFoundDefinition[],
  importedDefinitions: ReadonlyMap<string, ProjectDefinition> = new Map(),
  policies: RelationPolicyTable,
): StaticRelationBinding {
  const byVariable = new Map(found.map((item) => [item.variableName, item.definition]))
  const relations: ProjectRelation[] = []
  const unresolved: UnresolvedRelationRef[] = []
  const policyGapCounts = new Map<string, { sampleFact: RelationFactRef; count: number }>()
  for (const item of found) {
    for (const ref of item.relationRefs) {
      const fact = {
        ownerDefinitionId: ref.fromId ?? item.definition.id,
        refType: ref.type,
        toVariable: ref.toVariable,
        toId: ref.toId,
        source: item.definition.source,
      } satisfies RelationFactRef
      const policy = policies.policyFor(ref.type)
      if (!policy) {
        unresolved.push({ reason: 'no-policy', fact })
        const gap = policyGapCounts.get(ref.type)
        policyGapCounts.set(ref.type, {
          sampleFact: gap?.sampleFact ?? fact,
          count: (gap?.count ?? 0) + 1,
        })
        continue
      }
      const source = ref.fromVariable
        ? (byVariable.get(ref.fromVariable) ?? importedDefinitions.get(ref.fromVariable))
        : undefined
      const target = ref.toVariable
        ? (byVariable.get(ref.toVariable) ?? importedDefinitions.get(ref.toVariable))
        : undefined
      const targetId = ref.toId ?? target?.id ?? fallbackRelationTargetId(ref.type, ref.toVariable) ?? ref.fallbackToId
      const sourceId = ref.fromId ?? source?.id ?? item.definition.id
      const type = target?.kind && ref.typeByTargetKind?.[target.kind] ? ref.typeByTargetKind[target.kind] : ref.type
      if (!targetId || !type) {
        unresolved.push({ reason: target ? 'kind-mismatch' : 'no-fallback-id', fact })
        continue
      }
      const sourceFidelity = ref.fromId ? item.definition.fidelity : (source?.fidelity ?? item.definition.fidelity)
      const targetFidelity = ref.toId ? 'resolved' : target?.fidelity
      const fidelity = sourceFidelity === 'resolved' && targetFidelity === 'resolved' ? 'resolved' : 'partial'
      relations.push(
        projectRelation({
          type,
          from: sourceId,
          to: targetId,
          fidelity,
          source: item.definition.source,
        }),
      )
    }
  }
  return {
    relations,
    unresolved,
    policyGaps: [...policyGapCounts.entries()].map(([type, gap]) => ({ type, ...gap })),
  }
}

/**
 * Project-scope relations have already bound endpoints, but their type still has to be declared.
 *
 * Keeping undeclared relation types in the output preserves analyzer evidence for debugging while
 * the report makes the policy gap visible to compiler diagnostics and tests.
 */
function policyGapsForResolvedRelations(
  relations: readonly ProjectRelation[],
  policies: RelationPolicyTable,
): Array<{ readonly type: string; readonly sampleFact: RelationFactRef; readonly count: number }> {
  const gaps = new Map<string, { sampleFact: RelationFactRef; count: number }>()
  for (const relation of relations) {
    if (policies.policyFor(relation.type)) continue
    const current = gaps.get(relation.type)
    gaps.set(relation.type, {
      sampleFact: current?.sampleFact ?? {
        ownerDefinitionId: relation.from,
        refType: relation.type,
        toId: relation.to,
        source: relation.source,
      },
      count: (current?.count ?? 0) + 1,
    })
  }
  return [...gaps.entries()].map(([type, gap]) => ({ type, ...gap }))
}

/**
 * Static and project-scope policy gaps share diagnostics by relation type.
 */
function mergePolicyGaps(
  first: readonly { readonly type: string; readonly sampleFact: RelationFactRef; readonly count: number }[],
  second: readonly { readonly type: string; readonly sampleFact: RelationFactRef; readonly count: number }[],
): Array<{ readonly type: string; readonly sampleFact: RelationFactRef; readonly count: number }> {
  const byType = new Map<string, { sampleFact: RelationFactRef; count: number }>()
  for (const gap of [...first, ...second]) {
    const current = byType.get(gap.type)
    byType.set(gap.type, {
      sampleFact: current?.sampleFact ?? gap.sampleFact,
      count: (current?.count ?? 0) + gap.count,
    })
  }
  return [...byType.entries()].map(([type, gap]) => ({ type, ...gap }))
}

/**
 * Synthesizes a stable target id for relation refs that name a variable but not a definition id.
 *
 * This keeps legacy static extraction behavior intact while the resolver gains
 * accounting for cases where no safe fallback id exists.
 */
function fallbackRelationTargetId(type: string, variableName: string | undefined): string | undefined {
  if (!variableName) return undefined
  switch (type) {
    case 'agent.uses_prompt':
    case 'flow.step.uses_prompt':
      return `prompt:${safeVariableId(variableName)}`
    case 'prompt.uses_context':
    case 'context.uses_context':
    case 'injectable.uses_context':
      return `context:${safeVariableId(variableName)}`
    case 'prompt.uses_injectable':
    case 'context.uses_injectable':
      return `injectable:${safeVariableId(variableName)}`
    case 'prompt.uses_tool':
    case 'context.uses_tool':
    case 'injectable.uses_tool':
    case 'agent.uses_tool':
    case 'flow.step.uses_tool':
      return `tool:${variableName}`
    case 'prompt.uses_memory':
    case 'context.uses_memory':
    case 'agent.reads_memory':
    case 'agent.writes_memory':
    case 'prompt.reads_memory':
    case 'prompt.writes_memory':
    case 'context.reads_memory':
    case 'context.writes_memory':
    case 'tool.reads_memory':
    case 'tool.writes_memory':
    case 'flow.step.uses_memory':
    case 'flow.step.reads_memory':
    case 'flow.step.writes_memory':
    case 'swarm.uses_memory':
      return `memory:${safeVariableId(variableName)}`
    case 'prompt.uses_blackboard':
    case 'context.uses_blackboard':
    case 'agent.reads_blackboard':
    case 'agent.writes_blackboard':
    case 'prompt.reads_blackboard':
    case 'prompt.writes_blackboard':
    case 'context.reads_blackboard':
    case 'context.writes_blackboard':
    case 'tool.reads_blackboard':
    case 'tool.writes_blackboard':
    case 'flow.step.uses_blackboard':
    case 'flow.step.reads_blackboard':
    case 'flow.step.writes_blackboard':
    case 'swarm.uses_blackboard':
      return `blackboard:${safeVariableId(variableName)}`
    case 'agent.reads_workspace':
    case 'agent.writes_workspace':
    case 'prompt.reads_workspace':
    case 'prompt.writes_workspace':
    case 'context.reads_workspace':
    case 'context.writes_workspace':
    case 'tool.reads_workspace':
    case 'tool.writes_workspace':
    case 'flow.step.reads_workspace':
    case 'flow.step.writes_workspace':
      return `workspace:${safeVariableId(variableName)}`
    case 'flow.step.uses_agent':
    case 'composition.uses_agent':
    case 'parallel.branch.uses_agent':
    case 'pipeline.stage.uses_agent':
    case 'consensus.includes_agent':
    case 'swarm.includes_agent':
      return `agent:${safeVariableId(variableName)}`
    case 'composition.uses_prompt':
    case 'parallel.branch.uses_prompt':
    case 'pipeline.stage.uses_prompt':
      return `prompt:${safeVariableId(variableName)}`
    case 'composition.uses_tool':
    case 'parallel.branch.uses_tool':
    case 'pipeline.stage.uses_tool':
    case 'workspace.exposes_tool':
      return `tool:${variableName}`
    case 'composition.uses_flow':
    case 'parallel.branch.uses_flow':
    case 'pipeline.stage.uses_flow':
      return `flow:${safeVariableId(variableName)}`
    case 'agent.uses_routing':
    case 'flow.step.uses_routing':
    case 'composition.uses_routing':
    case 'parallel.branch.uses_routing':
    case 'pipeline.stage.uses_routing':
      return `routing.router:${safeVariableId(variableName)}`
    case 'consensus.uses_scorer':
    case 'rag.pipeline.stage.uses_scorer':
      return `scorer:${safeVariableId(variableName)}`
    case 'consensus.uses_judge':
      return `agent:${safeVariableId(variableName)}`
    case 'rag.pipeline.uses_retriever':
    case 'rag.pipeline.stage.uses_retriever':
      return `rag.retriever:${safeVariableId(variableName)}`
    case 'constraint.applies_to':
    case 'guardrail.applies_to':
    case 'eval.covers_definition':
      return variableName.includes(':') ? variableName : undefined
    default:
      return undefined
  }
}

/**
 * Mirrors the legacy static-id slugging rule for refs that only know an authored variable name.
 */
function safeVariableId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Ranks relation fidelity for deterministic conflict resolution.
 */
function relationFidelityRank(fidelity: ProjectRelationFidelity): number {
  if (fidelity === 'resolved') return 2
  if (fidelity === 'partial') return 1
  return 0
}

/**
 * Freezes the resolver's mutable accounting buckets into the public report shape.
 */
function relationReport(input: {
  readonly resolved: number
  readonly unresolved: readonly UnresolvedRelationRef[]
  readonly policyGaps: readonly {
    readonly type: string
    readonly sampleFact: RelationFactRef
    readonly count: number
  }[]
}): RelationResolutionReport {
  return {
    unresolved: input.unresolved,
    policyGaps: input.policyGaps,
    counts: {
      resolved: input.resolved,
      unresolved: input.unresolved.length,
      policyGaps: input.policyGaps.length,
    },
  }
}

/**
 * Project-scope resolution starts with no static binding work, but still follows the same merge path.
 */
function emptyStaticRelationBinding(): StaticRelationBinding {
  return { relations: [], unresolved: [], policyGaps: [] }
}

/**
 * Keeps policy-table validation failures machine-readable without throwing during module load.
 */
function policyTableDiagnostic(input: {
  readonly id: string
  readonly message: string
  readonly relatedDefinitionIds: readonly string[]
}): IndexDiagnostic {
  return {
    id: input.id,
    severity: 'error',
    code: 'relation.policy_table_invalid',
    message: input.message,
    relatedDefinitionIds: [...input.relatedDefinitionIds],
  }
}
