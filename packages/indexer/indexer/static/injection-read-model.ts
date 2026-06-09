import type {
  InjectionToolFacts,
  InjectionUseFacts,
  InputSchemaContribution,
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
} from '@crux/core/project-index'
import { factsUseEntries } from './use-entry-helpers'

export interface InjectionUsePath {
  readonly targetDefinitionId?: string
  readonly targetVariable?: string
  readonly targetKind?: ProjectDefinitionKind
  readonly relationType?: string
  readonly path: readonly string[]
  readonly conditionality?: InjectionUseFacts['conditionality']
  readonly branch?: string
  readonly via?: InjectionUseFacts['via']
  readonly fidelity?: ProjectRelation['fidelity']
}

export interface InjectionToolContribution {
  readonly name?: string
  readonly variable?: string
  readonly sourceDefinitionId: string
  readonly sourceKind: ProjectDefinitionKind
  readonly path: readonly string[]
  readonly dynamic?: boolean
  readonly conditionality?: InjectionUseFacts['conditionality']
  readonly branch?: string
}

export interface InjectionDynamicEntry {
  readonly ownerDefinitionId: string
  readonly variable?: string
  readonly conditionality?: InjectionUseFacts['conditionality']
  readonly via?: InjectionUseFacts['via']
  readonly branch?: string
}

export interface InjectionUnresolvedEntry {
  readonly ownerDefinitionId: string
  readonly variable?: string
  readonly conditionality?: InjectionUseFacts['conditionality']
  readonly via?: InjectionUseFacts['via']
  readonly branch?: string
}

export interface InjectionReadModel {
  readonly rootDefinitionId: string
  readonly rootKind: ProjectDefinitionKind
  readonly usePaths: readonly InjectionUsePath[]
  readonly inputContributions: readonly InputSchemaContribution[]
  readonly toolContributions: readonly InjectionToolContribution[]
  readonly dynamicEntries: readonly InjectionDynamicEntry[]
  readonly unresolvedEntries: readonly InjectionUnresolvedEntry[]
}

interface WalkState {
  readonly path: readonly string[]
  readonly conditionality?: InjectionUseFacts['conditionality']
  readonly via?: InjectionUseFacts['via']
  readonly branch?: string
}

const INJECTION_RELATION_TYPES = new Set([
  'prompt.uses_context',
  'prompt.uses_injectable',
  'prompt.uses_memory',
  'prompt.uses_blackboard',
  'context.uses_context',
  'context.uses_injectable',
  'context.uses_tool',
  'context.uses_memory',
  'context.uses_blackboard',
  'injectable.uses_context',
  'injectable.uses_tool',
  'injectable.uses_memory',
  'injectable.uses_blackboard',
])

const TRAVERSABLE_INJECTION_KINDS = new Set<ProjectDefinitionKind>(['context', 'injectable'])

export function buildInjectionReadModel(input: {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
  readonly rootDefinitionId: string
}): InjectionReadModel | undefined {
  const byId = new Map(input.definitions.map((definition) => [definition.id, definition]))
  const root = byId.get(input.rootDefinitionId)
  if (!root) return undefined

  const outgoing = new Map<string, ProjectRelation[]>()
  for (const relation of input.relations) {
    if (!INJECTION_RELATION_TYPES.has(relation.type)) continue
    const list = outgoing.get(relation.from) ?? []
    list.push(relation)
    outgoing.set(relation.from, list)
  }

  const usePaths: InjectionUsePath[] = []
  const toolContributions: InjectionToolContribution[] = []
  const dynamicEntries: InjectionDynamicEntry[] = []
  const unresolvedEntries: InjectionUnresolvedEntry[] = []
  const visitedEdges = new Set<string>()

  const visit = (definition: ProjectDefinition, state: WalkState): void => {
    for (const entry of factsUseEntries(definition)) {
      if (isDynamicUseEntry(entry)) {
        dynamicEntries.push({
          ownerDefinitionId: definition.id,
          ...(entry.variable ? { variable: entry.variable } : {}),
          ...(entry.conditionality ? { conditionality: entry.conditionality } : {}),
          ...(entry.via ? { via: entry.via } : {}),
          ...(entry.branch ? { branch: entry.branch } : {}),
        })
      }
      if (entry.variable && !entry.targetDefinitionId && !isDynamicUseEntry(entry)) {
        unresolvedEntries.push({
          ownerDefinitionId: definition.id,
          variable: entry.variable,
          ...(entry.conditionality ? { conditionality: entry.conditionality } : {}),
          ...(entry.via ? { via: entry.via } : {}),
          ...(entry.branch ? { branch: entry.branch } : {}),
        })
      }
    }

    const tools = toolsFacts(definition)
    if (tools?.hasTools) {
      const base = {
        sourceDefinitionId: definition.id,
        sourceKind: definition.kind,
        path: state.path,
        ...(tools.dynamic ? { dynamic: true } : {}),
        ...(state.conditionality ? { conditionality: state.conditionality } : {}),
        ...(state.branch ? { branch: state.branch } : {}),
      }
      for (const name of tools.names ?? []) toolContributions.push({ ...base, name })
      for (const variable of tools.variables ?? []) toolContributions.push({ ...base, variable })
      if (tools.dynamic && (tools.names?.length ?? 0) === 0 && (tools.variables?.length ?? 0) === 0) {
        toolContributions.push(base)
      }
    }

    for (const relation of outgoing.get(definition.id) ?? []) {
      if (visitedEdges.has(relation.id)) continue
      visitedEdges.add(relation.id)

      const target = byId.get(relation.to)
      const entry = target ? useEntryForTarget(definition, target, relation) : undefined
      const conditionality = combineConditionality(state.conditionality, entry?.conditionality)
      const via = entry?.via ?? state.via
      const branch = entry?.branch ?? state.branch
      const path = [...state.path, relation.to]
      usePaths.push({
        targetDefinitionId: relation.to,
        ...(entry?.variable ? { targetVariable: entry.variable } : {}),
        ...(target?.kind ? { targetKind: target.kind } : {}),
        relationType: relation.type,
        path,
        ...(conditionality ? { conditionality } : {}),
        ...(branch ? { branch } : {}),
        ...(via ? { via } : {}),
        fidelity: relation.fidelity,
      })

      if (target && TRAVERSABLE_INJECTION_KINDS.has(target.kind)) {
        visit(target, { path, conditionality, via, branch })
      }
    }
  }

  visit(root, { path: [root.id], conditionality: 'always', via: 'direct' })

  return {
    rootDefinitionId: root.id,
    rootKind: root.kind,
    usePaths,
    inputContributions: contractInputContributions(root),
    toolContributions,
    dynamicEntries,
    unresolvedEntries,
  }
}

export function buildAllInjectionReadModels(input: {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}): Map<string, InjectionReadModel> {
  const models = new Map<string, InjectionReadModel>()
  for (const definition of input.definitions) {
    if (!canOwnInjection(definition.kind)) continue
    const model = buildInjectionReadModel({
      definitions: input.definitions,
      relations: input.relations,
      rootDefinitionId: definition.id,
    })
    if (model) models.set(definition.id, model)
  }
  return models
}

export function contractInputSchema(definition: ProjectDefinition): JsonSchema | undefined {
  return (
    schemaRecord(definition.metadata?.intelligence?.contract?.inputSchema) ??
    schemaRecord(definition.metadata?.inputSchema)
  )
}

export function contractExpandedInputSchema(definition: ProjectDefinition): JsonSchema | undefined {
  return schemaRecord(definition.metadata?.intelligence?.contract?.expandedInputSchema)
}

export function contractInputContributions(definition: ProjectDefinition): readonly InputSchemaContribution[] {
  const contributions = definition.metadata?.intelligence?.contract?.inputContributions
  return Array.isArray(contributions) ? contributions : []
}

export function schemaRequiredFields(schema: JsonSchema | undefined): readonly string[] {
  return Array.isArray(schema?.required)
    ? schema.required.filter((field): field is string => typeof field === 'string')
    : []
}

export function schemaProperties(schema: JsonSchema | undefined): Record<string, JsonSchema> {
  const properties = schema?.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {}
  return properties as Record<string, JsonSchema>
}

export function contributionSourceRequiresField(
  contribution: InputSchemaContribution,
  definitionsById: ReadonlyMap<string, ProjectDefinition>,
): boolean {
  if (!contribution.sourceDefinitionId) return contribution.required === true
  const source = definitionsById.get(contribution.sourceDefinitionId)
  return schemaRequiredFields(source ? contractInputSchema(source) : undefined).includes(contribution.field)
}

function canOwnInjection(kind: ProjectDefinitionKind): boolean {
  return kind === 'prompt' || kind === 'context' || kind === 'injectable'
}

function toolsFacts(definition: ProjectDefinition): InjectionToolFacts | undefined {
  const facts = definition.metadata?.facts
  if (!facts || typeof facts !== 'object' || !('tools' in facts)) return undefined
  const tools = (facts as { tools?: unknown }).tools
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return undefined
  const record = tools as Partial<InjectionToolFacts>
  if (record.hasTools !== true) return undefined
  return {
    hasTools: true,
    ...(record.dynamic === true ? { dynamic: true } : {}),
    ...(Array.isArray(record.names)
      ? { names: record.names.filter((name): name is string => typeof name === 'string') }
      : {}),
    ...(Array.isArray(record.variables)
      ? { variables: record.variables.filter((variable): variable is string => typeof variable === 'string') }
      : {}),
  }
}

function useEntryForTarget(
  owner: ProjectDefinition,
  target: ProjectDefinition,
  relation: ProjectRelation,
): InjectionUseFacts | undefined {
  return factsUseEntries(owner).find((entry) => {
    if (entry.targetDefinitionId === relation.to) return true
    if (!entry.variable) return false
    return (
      entry.variable === target.name ||
      entry.variable === target.metadata?.exportName ||
      target.id.endsWith(`:${entry.variable}`)
    )
  })
}

function combineConditionality(
  inherited: InjectionUseFacts['conditionality'] | undefined,
  current: InjectionUseFacts['conditionality'] | undefined,
): InjectionUseFacts['conditionality'] | undefined {
  if (!inherited || inherited === 'always') return current ?? inherited
  return inherited
}

function isDynamicUseEntry(entry: InjectionUseFacts): boolean {
  return entry.conditionality === 'dynamic' || entry.conditionality === 'unknown' || entry.via === 'runtime'
}

function schemaRecord(value: unknown): JsonSchema | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as JsonSchema
}
