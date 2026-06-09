import type {
  InjectionUseFacts,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
} from '@crux/core/project-index'
import { resolveStaticRelationReferences } from '../extensions'
import { staticFoundDefinitionsFromExtractedFacts } from '../extensions/static-normalizer'
import type { StaticFactParseResult, StaticParseResult } from '../types'
import { withExpandedInputContracts } from './input-contracts'
import { factsUseEntries, relationHintForTarget, safeUseEntryId } from './use-entry-helpers'

/**
 * Projects extracted static facts into the read model consumed by patch builders
 * and index snapshots.
 */
export function staticParseResultFromFacts(input: StaticFactParseResult): StaticParseResult {
  const found = staticFoundDefinitionsFromExtractedFacts(input.facts)
  const relations = resolveStaticRelationReferences(found, input.importedDefinitions)
  const definitions = withResolvedInjectionReadModel(
    withResolvedRoutingTargetMetadata(
      [...found.flatMap((item) => [item.definition, ...(item.extraDefinitions ?? [])]), ...input.pathDefinitions],
      relations,
    ),
    relations,
  )
  return { definitions, relations, diagnostics: input.diagnostics, dependencies: input.dependencies }
}

/** Projects resolved injection graph facts into definition metadata for index consumers. */
export function withResolvedInjectionReadModel(
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

/** Enriches route-like child definitions with resolved target metadata for detail-panel consumers. */
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

/** Mirrors resolved relations into dependency buckets so detail views can group real targets by kind. */
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
 * Maps dependency-style relation types to metadata dependency bucket names.
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

/** Attaches resolved graph targets to authored use entries so UI consumers do not have to guess by variable name. */
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
 * Consumes the first relation candidate matching one authored use entry.
 *
 * The candidates array is intentionally caller-owned scratch state for this
 * projection pass, preventing one relation from being matched to multiple
 * entries.
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
 * Checks whether a resolved relation plausibly corresponds to one authored use
 * entry variable.
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
 * Classifies relation types that represent injection/use dependencies.
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

/** Connects runtime prepare use entries to statically discovered definitions when the factory is visible. */
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
 * Returns whether a definition can be matched from runtime `prepare` use-entry
 * variables.
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
 * Detects tool-context definitions produced by static facts.
 */
function definitionHasToolFacts(definition: ProjectDefinition): boolean {
  const facts = definition.metadata?.facts
  if (!facts || typeof facts !== 'object' || !('tools' in facts)) return false
  const tools = (facts as { tools?: { hasTools?: unknown } }).tools
  return tools?.hasTools === true
}

/**
 * Resolves a runtime prepare variable such as `tools`, `x.memory`, or
 * `blackboard` to the best static target definition.
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
 * Builds the partial relation type implied by a runtime prepare use-entry match.
 */
function runtimeUseRelationType(ownerKind: ProjectDefinitionKind, targetKind: ProjectDefinitionKind): string {
  if (targetKind === 'memory') return `${ownerKind}.uses_memory`
  if (targetKind === 'blackboard') return `${ownerKind}.uses_blackboard`
  if (targetKind === 'injectable') return `${ownerKind}.uses_injectable`
  return `${ownerKind}.uses_context`
}

/**
 * Expands historical/semantic aliases for runtime memory owner variable names.
 */
function runtimeMemoryOwnerAliases(owner: string): string[] {
  if (owner === 'episodic') return ['episodic', 'episodes', 'user-episodes']
  return [owner]
}

/** Maps a validated routing relation type back to the index kind exposed on child metadata. */
function routingTargetKindForRelation(type: string): ProjectDefinitionKind | undefined {
  if (!isRoutingTargetRelation(type)) return undefined
  if (type.endsWith('.uses_router')) return 'routing.router'
  if (type.endsWith('.uses_cascade')) return 'routing.cascade'
  if (type.endsWith('.uses_fallback')) return 'routing.fallback'
  if (type.endsWith('.uses_agent')) return 'agent'
  if (type.endsWith('.uses_prompt')) return 'prompt'
  return undefined
}

/** Identifies routing relations whose target should be mirrored into child metadata. */
function isRoutingTargetRelation(type: string): boolean {
  return (
    type.startsWith('router.route.uses_') ||
    type.startsWith('cascade.tier.uses_') ||
    type.startsWith('fallback.option.uses_')
  )
}
