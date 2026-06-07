import ts from 'typescript'
import type {
  InjectionUseFacts,
  InputSchemaContribution,
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
} from '@crux/core/catalog'
import { collectTopLevelInitializers, scopedInitializersForNode } from './ast/initializers'
import { collectImportBindings } from './ast/imports'
import { readSourceFile } from './ast/parse'
import { resolveStaticRelationReferences } from './extensions'
import { staticFoundDefinitionsFromExtractedFacts } from './extensions/static-normalizer'
import { staticPrimitiveCallNames } from './extractors/registry'
import type {
  ImportBinding,
  StaticFactParser,
  StaticFactParseResult,
  StaticFoundDefinition,
  StaticParseResult,
} from './types'

const staticParserSpecialCallNames = new Set(['convexAgent'])

/** Reads one TypeScript source file and returns source-local compiler facts plus declared dependencies. */
export async function parseStaticFacts(
  root: string,
  file: string,
  parser: StaticFactParser,
): Promise<StaticFactParseResult> {
  const sourceFile = await readSourceFile(file)
  const localInitializers = new Map<string, ts.Expression>()
  const importBindings = collectImportBindings(sourceFile, root, file)

  collectTopLevelInitializers(sourceFile, localInitializers)

  const exported = exportedStaticFacts(root, file, sourceFile, localInitializers, importBindings, parser)
  const callSites = callSiteStaticFacts(
    root,
    file,
    sourceFile,
    localInitializers,
    importBindings,
    exported.foundForPathProjection,
    parser,
  )
  const facts = [...exported.facts, ...callSites.facts]
  const foundForPathProjection = [...exported.foundForPathProjection, ...callSites.foundForPathProjection]
  const pathDefinitions = await parser.staticTreePathDefinitions(
    root,
    file,
    sourceFile,
    localInitializers,
    foundForPathProjection,
    importBindings,
  )
  const importedDefinitions = await importedDefinitionsForFactRelations(root, importBindings, parser)
  const dependencies = [...new Set([...importBindings.values()].map((binding) => binding.file))].sort()

  return { facts, pathDefinitions, importedDefinitions, dependencies }
}

/** Extracts exported top-level definitions before call-site discovery so path projection has stable anchors. */
function exportedStaticFacts(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  localInitializers: Map<string, ts.Expression>,
  importBindings: Map<string, ImportBinding>,
  parser: StaticFactParser,
): { facts: NonNullable<StaticFactParseResult['facts']>; foundForPathProjection: StaticFoundDefinition[] } {
  const facts: NonNullable<StaticFactParseResult['facts']> = []
  const foundForPathProjection: StaticFoundDefinition[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && parser.hasExportModifier(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        const extracted = parser.staticFactsFromInitializer(
          root,
          file,
          sourceFile,
          declaration.name.text,
          declaration.initializer,
          localInitializers,
          importBindings,
        )
        if (!extracted) continue
        facts.push(extracted)
        const found = staticFoundDefinitionsFromExtractedFacts([extracted])[0]
        if (found) foundForPathProjection.push(found)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { facts, foundForPathProjection }
}

/** Runs fact extraction and projects the result into the static catalog shape consumed by indexers. */
export async function parseStaticDefinitionsFromFacts(
  root: string,
  file: string,
  parser: StaticFactParser,
): Promise<StaticParseResult> {
  return staticParseResultFromFacts(await parseStaticFacts(root, file, parser))
}

/** Resolves references and attaches compiler-owned metadata without re-reading source files. */
export function staticParseResultFromFacts(input: StaticFactParseResult): StaticParseResult {
  const found = staticFoundDefinitionsFromExtractedFacts(input.facts)
  const relations = resolveStaticRelationReferences(found, input.importedDefinitions)
  const definitions = withExpandedInputContracts(
    withResolvedRelationDependencyFacts(
      withResolvedRoutingTargetMetadata(
        [...found.flatMap((item) => [item.definition, ...(item.extraDefinitions ?? [])]), ...input.pathDefinitions],
        relations,
      ),
      relations,
    ),
    relations,
  )
  return { definitions, relations, dependencies: input.dependencies }
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

/** Adds an effective input contract assembled from statically resolved injection dependencies. */
function withExpandedInputContracts(
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

function contributionsFromSchema(
  schema: JsonSchema | undefined,
  source: ProjectDefinition,
  path: readonly string[],
  edge: Pick<InputSchemaContribution, 'conditionality' | 'via' | 'branch'>,
): InputSchemaContribution[] {
  const properties = schemaProperties(schema)
  if (!properties) return []
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [])
  return Object.entries(properties).map(([field, fieldSchema]) => ({
    field,
    schema: fieldSchema,
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

function mergeObjectSchemaContributions(
  base: JsonSchema | undefined,
  contributions: readonly InputSchemaContribution[],
): JsonSchema {
  const expanded: JsonSchema = base ?? { type: 'object' }
  const ownProperties = schemaProperties(expanded)
  const properties: Record<string, JsonSchema> = { ...(ownProperties ?? {}) }
  const required = new Set(
    Array.isArray(expanded.required) ? expanded.required.filter((item): item is string => typeof item === 'string') : [],
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

function cloneObjectSchema(schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema) return undefined
  const properties = schemaProperties(schema)
  return {
    ...schema,
    ...(properties ? { properties: { ...properties } } : {}),
    ...(Array.isArray(schema.required) ? { required: [...schema.required] } : {}),
  }
}

function schemaProperties(schema: JsonSchema | undefined): Record<string, JsonSchema> | undefined {
  const properties = schema?.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return undefined
  return properties as Record<string, JsonSchema>
}

function useFactsForTarget(owner: ProjectDefinition, target: ProjectDefinition): InjectionUseFacts | undefined {
  const entries = factsUseEntries(owner)
  return entries.find((entry) => {
    if (!entry.variable) return false
    return entry.variable === target.name || entry.variable === target.metadata?.exportName || target.id.endsWith(`:${entry.variable}`)
  })
}

function factsUseEntries(definition: ProjectDefinition): readonly InjectionUseFacts[] {
  const facts = definition.metadata?.facts
  if (!facts || typeof facts !== 'object' || !('useEntries' in facts)) return []
  const entries = (facts as { useEntries?: unknown }).useEntries
  return Array.isArray(entries) ? (entries.filter(isInjectionUseFacts) as InjectionUseFacts[]) : []
}

function isInjectionUseFacts(value: unknown): value is InjectionUseFacts {
  return Boolean(value && typeof value === 'object')
}

function combineConditionality(
  inherited: InputSchemaContribution['conditionality'],
  current: InjectionUseFacts['conditionality'] | undefined,
): InputSchemaContribution['conditionality'] {
  if (!inherited || inherited === 'always') return current ?? inherited ?? 'always'
  return inherited
}

function canReceiveInjectedInput(kind: ProjectDefinitionKind): boolean {
  return kind === 'prompt' || kind === 'context' || kind === 'injectable'
}

function canContributeInput(kind: ProjectDefinitionKind): boolean {
  return kind === 'context' || kind === 'injectable'
}

function isInputInjectingRelation(type: string): boolean {
  return (
    type === 'prompt.uses_context' ||
    type === 'prompt.uses_injectable' ||
    type === 'context.uses_context' ||
    type === 'context.uses_injectable' ||
    type === 'injectable.uses_context'
  )
}

/** Maps a validated routing relation type back to the catalog kind exposed on child metadata. */
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

/**
 * Resolves imported definitions so relation refs can point at targets defined in other files.
 * Relation targets must be named exports because default exports have no stable named binding to match.
 */
async function importedDefinitionsForFactRelations(
  root: string,
  importBindings: Map<string, ImportBinding>,
  parser: StaticFactParser,
): Promise<Map<string, ProjectDefinition>> {
  const definitions = new Map<string, ProjectDefinition>()
  const parsedFiles = new Map<
    string,
    {
      sourceFile: ts.SourceFile
      localInitializers: Map<string, ts.Expression>
      importBindings: Map<string, ImportBinding>
    }
  >()

  for (const [localName, binding] of importBindings) {
    if (binding.importedName === 'default') continue
    let parsed = parsedFiles.get(binding.file)
    if (!parsed) {
      try {
        const sourceFile = await readSourceFile(binding.file)
        const localInitializers = new Map<string, ts.Expression>()
        collectTopLevelInitializers(sourceFile, localInitializers)
        parsed = {
          sourceFile,
          localInitializers,
          importBindings: collectImportBindings(sourceFile, root, binding.file),
        }
        parsedFiles.set(binding.file, parsed)
      } catch {
        continue
      }
    }
    const initializer = parsed.localInitializers.get(binding.importedName)
    if (!initializer) continue
    const extracted = parser.staticFactsFromInitializer(
      root,
      binding.file,
      parsed.sourceFile,
      binding.importedName,
      initializer,
      parsed.localInitializers,
      parsed.importBindings,
    )
    const found = extracted ? staticFoundDefinitionsFromExtractedFacts([extracted])[0] : undefined
    if (found) definitions.set(localName, found.definition)
  }

  return definitions
}

/** Extracts local call-site definitions while keeping duplicate suppression local to this projection pass. */
function callSiteStaticFacts(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  localInitializers: Map<string, ts.Expression>,
  importBindings: Map<string, ImportBinding>,
  exportedFoundForPathProjection: readonly StaticFoundDefinition[],
  parser: StaticFactParser,
): { facts: NonNullable<StaticFactParseResult['facts']>; foundForPathProjection: StaticFoundDefinition[] } {
  const facts: NonNullable<StaticFactParseResult['facts']> = []
  const foundForPathProjection: StaticFoundDefinition[] = []
  const seen = new Set(exportedFoundForPathProjection.map((item) => item.definition.id))

  const addFacts = (extracted: StaticFactParseResult['facts'][number] | undefined): void => {
    if (!extracted) return
    const found = staticFoundDefinitionsFromExtractedFacts([extracted])[0]
    if (!found || seen.has(found.definition.id)) return
    seen.add(found.definition.id)
    facts.push(extracted)
    foundForPathProjection.push(found)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && !parser.hasExportModifier(node)) {
      const scopedInitializers = scopedInitializersForNode(node, localInitializers)
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        addFacts(
          parser.staticFactsFromInitializer(
            root,
            file,
            sourceFile,
            declaration.name.text,
            declaration.initializer,
            scopedInitializers,
            importBindings,
          ),
        )
      }
    }
    if (ts.isCallExpression(node)) {
      const callName = parser.expressionName(node.expression)
      if (callName && (staticPrimitiveCallNames.has(callName) || staticParserSpecialCallNames.has(callName))) {
        const scopedInitializers = scopedInitializersForNode(node, localInitializers)
        addFacts(parser.staticFactsFromCall(root, file, sourceFile, callName, node, scopedInitializers, importBindings))
      }
    }
    if (ts.isNewExpression(node) && parser.expressionName(node.expression) === 'Agent') {
      const scopedInitializers = scopedInitializersForNode(node, localInitializers)
      const sourceLine = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1
      addFacts(
        parser.staticFactsFromInitializer(
          root,
          file,
          sourceFile,
          `agent-${sourceLine}`,
          node,
          scopedInitializers,
          importBindings,
        ),
      )
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { facts, foundForPathProjection }
}
