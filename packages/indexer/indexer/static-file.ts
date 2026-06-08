import ts from 'typescript'
import type {
  InjectionUseFacts,
  InputSchemaContribution,
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
} from '@crux/core/project-index'
import { collectTopLevelInitializers, scopedInitializersForNode } from './ast/initializers'
import { collectImportBindings } from './ast/imports'
import { propertyName } from './ast/literals'
import { readSourceFile } from './ast/parse'
import { resolveStaticRelationReferences } from './extensions'
import type { ExtractedFacts } from './extensions'
import { staticFoundDefinitionsFromExtractedFacts } from './extensions/static-normalizer'
import type {
  ImportBinding,
  StaticFactParser,
  StaticFactParseResult,
  StaticFoundDefinition,
  StaticParseResult,
} from './types'

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
  const facts = [...exported.facts, ...callSites.facts, ...staticRuntimePrepareFacts(sourceFile)]
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
  const diagnostics = facts.flatMap((fact) => fact.diagnostics ?? [])
  const dependencies = [
    ...new Set([
      ...[...importBindings.values()].map((binding) => binding.file),
      ...facts.flatMap((fact) =>
        (fact.dependencies ?? [])
          .filter((dependency) => dependency.kind === 'source-file')
          .map((dependency) => dependency.file),
      ),
    ]),
  ].sort()

  return { facts, pathDefinitions, importedDefinitions, diagnostics, dependencies }
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

function staticRuntimePrepareFacts(sourceFile: ts.SourceFile): ExtractedFacts[] {
  const functions = new Map<string, ts.FunctionDeclaration>()
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) functions.set(statement.name.text, statement)
  }

  const facts: ExtractedFacts[] = []
  const visit = (node: ts.Node): void => {
    if (!ts.isReturnStatement(node) || !node.expression) {
      ts.forEachChild(node, visit)
      return
    }
    const object = returnedObjectLiteral(node.expression)
    const useExpression = object ? propertyExpressionFromObject(object, 'use') : undefined
    const helperCall = useExpression ? awaitedCallExpression(useExpression) : undefined
    const helperName = helperCall ? expressionName(helperCall.expression) : undefined
    const helper = helperName ? functions.get(helperName) : undefined
    const promptVariable = preparePromptVariable(node)
    if (!helperCall || !helper || !promptVariable) {
      ts.forEachChild(node, visit)
      return
    }

    const useEntries = runtimeUseEntriesFromHelper(helper, helperCall, sourceFile)
    if (useEntries.length > 0) {
      const promptId = `prompt:${safeRuntimeId(promptVariable)}`
      facts.push({
        definitions: [
          {
            variableName: `runtimePrepare:${promptVariable}`,
            definition: {
              id: promptId,
              kind: 'prompt',
              name: promptVariable,
              fidelity: 'partial',
              status: 'active',
              metadata: {
                facts: {
                  kind: 'prompt',
                  useEntries,
                },
              },
            },
          },
        ],
      })
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return facts
}

function returnedObjectLiteral(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  if (ts.isParenthesizedExpression(expression) && ts.isObjectLiteralExpression(expression.expression))
    return expression.expression
  return ts.isObjectLiteralExpression(expression) ? expression : undefined
}

function propertyExpressionFromObject(object: ts.ObjectLiteralExpression, property: string): ts.Expression | undefined {
  const assignment = object.properties.find((item): item is ts.PropertyAssignment => {
    if (!ts.isPropertyAssignment(item)) return false
    return propertyName(item.name) === property
  })
  return assignment?.initializer
}

function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

function preparePromptVariable(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node
  while (current) {
    const typeText = ts.isFunctionLike(current) && current.type ? current.type.getText() : undefined
    const match = typeText?.match(/ConvexAgentPrepare(?:Args|Result)<typeof\s+([A-Za-z_$][\w$]*)>/)
    if (match?.[1]) return match[1]
    current = current.parent
  }
  return undefined
}

function awaitedCallExpression(expression: ts.Expression): ts.CallExpression | undefined {
  const unwrapped = ts.isAwaitExpression(expression) ? expression.expression : expression
  return ts.isCallExpression(unwrapped) ? unwrapped : undefined
}

function runtimeUseEntriesFromHelper(
  helper: ts.FunctionDeclaration,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): InjectionUseFacts[] {
  const localInitializers = new Map<string, ts.Expression>()
  helper.forEachChild((node) => collectFunctionScopedInitializers(node, localInitializers))
  const argumentTextByParameter = new Map<string, string>()
  helper.parameters.forEach((parameter, index) => {
    if (!ts.isIdentifier(parameter.name)) return
    const argument = call.arguments[index]
    if (argument) argumentTextByParameter.set(parameter.name.text, argument.getText(sourceFile))
  })

  const entries: InjectionUseFacts[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = ts.isParenthesizedExpression(node.expression) ? node.expression.expression : node.expression
      if (ts.isArrayLiteralExpression(expression)) {
        entries.push(...runtimeUseEntriesFromArray(expression, sourceFile, localInitializers, argumentTextByParameter))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(helper)
  return entries
}

function collectFunctionScopedInitializers(node: ts.Node, localInitializers: Map<string, ts.Expression>): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    localInitializers.set(node.name.text, node.initializer)
  }
  ts.forEachChild(node, (child) => collectFunctionScopedInitializers(child, localInitializers))
}

function runtimeUseEntriesFromArray(
  array: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile,
  localInitializers: ReadonlyMap<string, ts.Expression>,
  argumentTextByParameter: ReadonlyMap<string, string>,
): InjectionUseFacts[] {
  return array.elements.flatMap((element): InjectionUseFacts[] => {
    if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression)) {
      const initializer = localInitializers.get(element.expression.text)
      if (initializer && ts.isConditionalExpression(initializer)) {
        return runtimeUseEntriesFromConditionalArray(initializer, sourceFile, argumentTextByParameter)
      }
      return [runtimeUseEntry(element.expression.getText(sourceFile), { conditionality: 'dynamic', via: 'spread' })]
    }
    return [runtimeUseEntry(element.getText(sourceFile), { conditionality: 'dynamic', via: 'runtime' })]
  })
}

function runtimeUseEntriesFromConditionalArray(
  expression: ts.ConditionalExpression,
  sourceFile: ts.SourceFile,
  argumentTextByParameter: ReadonlyMap<string, string>,
): InjectionUseFacts[] {
  const condition = substitutePrepareArguments(expression.condition.getText(sourceFile), argumentTextByParameter)
  const whenTrue = ts.isArrayLiteralExpression(expression.whenTrue)
    ? runtimeUseEntriesFromArray(expression.whenTrue, sourceFile, new Map(), argumentTextByParameter)
    : []
  return whenTrue.map((entry) => ({
    ...entry,
    conditionality: 'when',
    via: 'runtime',
    branch: condition,
  }))
}

function substitutePrepareArguments(text: string, argumentTextByParameter: ReadonlyMap<string, string>): string {
  let result = text
  for (const [name, value] of argumentTextByParameter) {
    result = result.replace(new RegExp(`\\b${escapeRegExp(name)}\\.`, 'g'), `${value}.`)
  }
  return result
}

function runtimeUseEntry(
  variable: string,
  defaults: Pick<InjectionUseFacts, 'conditionality' | 'via'>,
): InjectionUseFacts {
  return {
    variable,
    relationHint: runtimeRelationHint(variable),
    ...defaults,
  }
}

function runtimeRelationHint(variable: string): InjectionUseFacts['relationHint'] {
  const lower = variable.toLowerCase()
  if (lower.includes('memory')) return 'memory'
  if (lower.includes('blackboard')) return 'blackboard'
  return 'unknown'
}

function safeRuntimeId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .toLowerCase()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Runs fact extraction and projects the result into the static index shape consumed by indexers. */
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

function safeUseEntryId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .toLowerCase()
}

function relationHintForTarget(kind: ProjectDefinitionKind | undefined): InjectionUseFacts['relationHint'] | undefined {
  if (kind === 'context' || kind === 'injectable' || kind === 'memory' || kind === 'blackboard') return kind
  return undefined
}

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

function isRuntimeUseTarget(definition: ProjectDefinition): boolean {
  return (
    definition.kind === 'memory' ||
    definition.kind === 'blackboard' ||
    definition.kind === 'rag.retriever' ||
    (definition.kind === 'context' && definitionHasToolFacts(definition))
  )
}

function definitionHasToolFacts(definition: ProjectDefinition): boolean {
  const facts = definition.metadata?.facts
  if (!facts || typeof facts !== 'object' || !('tools' in facts)) return false
  const tools = (facts as { tools?: { hasTools?: unknown } }).tools
  return tools?.hasTools === true
}

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

function runtimeUseRelationType(ownerKind: ProjectDefinitionKind, targetKind: ProjectDefinitionKind): string {
  if (targetKind === 'memory') return `${ownerKind}.uses_memory`
  if (targetKind === 'blackboard') return `${ownerKind}.uses_blackboard`
  if (targetKind === 'injectable') return `${ownerKind}.uses_injectable`
  return `${ownerKind}.uses_context`
}

function runtimeMemoryOwnerAliases(owner: string): string[] {
  if (owner === 'episodic') return ['episodic', 'episodes', 'user-episodes']
  return [owner]
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
    return (
      entry.variable === target.name ||
      entry.variable === target.metadata?.exportName ||
      target.id.endsWith(`:${entry.variable}`)
    )
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
      if (callName && parserCallNames(parser).has(callName)) {
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

function parserCallNames(parser: StaticFactParser): ReadonlySet<string> {
  return parser.staticCallNames ?? new Set()
}
