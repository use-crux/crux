import type {
  InjectionUseFacts,
  InputSchemaContribution,
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
} from '@crux/core/project-index'
import { factsUseEntries } from './use-entry-helpers'

/**
 * Adds an effective input contract assembled from statically resolved injection
 * dependencies.
 *
 * The function is a pure read-model projection: it receives definitions and
 * relations, returns fresh enriched definitions, and does not mutate metadata
 * from the parser output.
 */
export function withExpandedInputContracts(
  definitions: readonly ProjectDefinition[],
  relations: readonly ProjectRelation[],
): ProjectDefinition[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]))
  const outgoing = new Map<string, ProjectRelation[]>()
  for (const relation of relations) {
    const list = outgoing.get(relation.from) ?? []
    list.push(relation)
    outgoing.set(relation.from, list)
  }

  return definitions.map((definition) => {
    if (!canReceiveInjectedInput(definition.kind)) return definition
    const contract = definition.metadata?.intelligence?.contract
    const ownInputSchema = contract?.inputSchema ?? definition.metadata?.inputSchema
    const base = cloneObjectSchema(ownInputSchema)
    const contributions = collectInputContributions(definition, byId, outgoing)
    if (contributions.length === 0) return definition
    const expandedInputSchema = mergeObjectSchemaContributions(base, contributions)
    return {
      ...definition,
      metadata: {
        ...(definition.metadata ?? {}),
        intelligence: {
          ...(definition.metadata?.intelligence ?? { confidence: 'static' }),
          contract: {
            ...(contract ?? {}),
            ...(ownInputSchema ? { inputSchema: ownInputSchema } : {}),
            expandedInputSchema,
            inputContributions: contributions,
          },
        },
      },
    }
  })
}

/**
 * Recursively walks injection edges from an owner and collects input fields
 * contributed by reachable context/injectable definitions.
 */
function collectInputContributions(
  owner: ProjectDefinition,
  byId: ReadonlyMap<string, ProjectDefinition>,
  outgoing: ReadonlyMap<string, readonly ProjectRelation[]>,
): InputSchemaContribution[] {
  const out: InputSchemaContribution[] = []
  const seenEdges = new Set<string>()
  const seenFields = new Set<string>()

  const visit = (
    from: ProjectDefinition,
    path: readonly string[],
    inherited: Pick<InputSchemaContribution, 'conditionality' | 'via' | 'branch'>,
  ): void => {
    for (const relation of outgoing.get(from.id) ?? []) {
      if (!isInputInjectingRelation(relation.type)) continue
      if (seenEdges.has(relation.id)) continue
      seenEdges.add(relation.id)

      const target = byId.get(relation.to)
      if (!target || !canContributeInput(target.kind)) continue
      const edge = useFactsForTarget(from, target) ?? {}
      const conditionality = combineConditionality(inherited.conditionality, edge.conditionality)
      const via = edge.via ?? inherited.via
      const branch = edge.branch ?? inherited.branch
      const nextPath = [...path, target.id]
      const schema = target.metadata?.intelligence?.contract?.inputSchema ?? target.metadata?.inputSchema
      for (const contribution of contributionsFromSchema(schema, target, nextPath, {
        conditionality,
        via,
        branch,
      })) {
        const key = `${contribution.field}:${contribution.sourceDefinitionId ?? ''}:${contribution.path?.join('>') ?? ''}`
        if (seenFields.has(key)) continue
        seenFields.add(key)
        out.push(contribution)
      }
      visit(target, nextPath, { conditionality, via, branch })
    }
  }

  visit(owner, [owner.id], { conditionality: 'always', via: 'direct' })
  return out
}

/**
 * Converts a source definition's object schema into field-level input
 * contributions inherited through an injection edge.
 */
function contributionsFromSchema(
  schema: JsonSchema | undefined,
  source: ProjectDefinition,
  path: readonly string[],
  edge: Pick<InputSchemaContribution, 'conditionality' | 'via' | 'branch'>,
): InputSchemaContribution[] {
  const properties = schemaProperties(schema)
  if (!properties) return []
  const required = new Set(
    Array.isArray(schema?.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [],
  )
  return Object.entries(properties).map(([field, fieldSchema]) => ({
    field,
    schema: fieldSchema,
    ...(typeof fieldSchema.description === 'string' ? { description: fieldSchema.description } : {}),
    required: required.has(field) && (edge.conditionality ?? 'always') === 'always',
    sourceDefinitionId: source.id,
    sourceName: source.name,
    sourceKind: source.kind,
    path: [...path],
    ...(edge.via ? { via: edge.via } : {}),
    ...(edge.conditionality ? { conditionality: edge.conditionality } : {}),
    ...(edge.branch ? { branch: edge.branch } : {}),
  }))
}

/**
 * Merges inherited field contributions into a base object schema without
 * mutating the base schema object.
 */
function mergeObjectSchemaContributions(
  base: JsonSchema | undefined,
  contributions: readonly InputSchemaContribution[],
): JsonSchema {
  const expanded: JsonSchema = base ?? { type: 'object' }
  const ownProperties = schemaProperties(expanded)
  const properties: Record<string, JsonSchema> = { ...(ownProperties ?? {}) }
  const required = new Set(
    Array.isArray(expanded.required)
      ? expanded.required.filter((item): item is string => typeof item === 'string')
      : [],
  )
  for (const contribution of contributions) {
    if (!properties[contribution.field] && contribution.schema) properties[contribution.field] = contribution.schema
    if (contribution.required) required.add(contribution.field)
  }
  return {
    ...expanded,
    type: expanded.type ?? 'object',
    properties,
    ...(required.size > 0 ? { required: [...required] } : {}),
  }
}

/**
 * Shallow-clones an object schema before adding inherited properties.
 */
function cloneObjectSchema(schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema) return undefined
  const properties = schemaProperties(schema)
  return {
    ...schema,
    ...(properties ? { properties: { ...properties } } : {}),
    ...(Array.isArray(schema.required) ? { required: [...schema.required] } : {}),
  }
}

/**
 * Safely reads object-schema properties from unknown-ish JSON schema metadata.
 */
function schemaProperties(schema: JsonSchema | undefined): Record<string, JsonSchema> | undefined {
  const properties = schema?.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return undefined
  return properties as Record<string, JsonSchema>
}

/**
 * Finds the authored use-entry metadata that corresponds to an injection
 * target.
 */
function useFactsForTarget(owner: ProjectDefinition, target: ProjectDefinition): InjectionUseFacts | undefined {
  const entries = factsUseEntries(owner)
  return entries.find((entry) => {
    if (!entry.variable) return false
    return (
      entry.variable === target.name ||
      entry.variable === target.metadata?.exportName ||
      target.id.endsWith(`:${entry.variable}`)
    )
  })
}

/**
 * Combines inherited and edge-local conditionality, preserving existing
 * conditional branches once a path becomes non-always.
 */
function combineConditionality(
  inherited: InputSchemaContribution['conditionality'],
  current: InjectionUseFacts['conditionality'] | undefined,
): InputSchemaContribution['conditionality'] {
  if (!inherited || inherited === 'always') return current ?? inherited ?? 'always'
  return inherited
}

/**
 * Returns whether a definition kind can receive injected input fields.
 */
function canReceiveInjectedInput(kind: ProjectDefinitionKind): boolean {
  return kind === 'prompt' || kind === 'context' || kind === 'injectable'
}

/**
 * Returns whether a definition kind can contribute input schema fields.
 */
function canContributeInput(kind: ProjectDefinitionKind): boolean {
  return kind === 'context' || kind === 'injectable'
}

/**
 * Identifies relations whose target input schema contributes to the owner.
 */
function isInputInjectingRelation(type: string): boolean {
  return (
    type === 'prompt.uses_context' ||
    type === 'prompt.uses_injectable' ||
    type === 'context.uses_context' ||
    type === 'context.uses_injectable' ||
    type === 'injectable.uses_context'
  )
}
