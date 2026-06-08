import { relative } from 'node:path'
import ts from 'typescript'
import type {
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRuntimeJoin,
  SourceLocation,
  SourceSnippet,
} from '@crux/core/project-index'
import { collectTopLevelInitializers } from './ast/initializers'
import { hasProperty, propertyName, stringArrayProperty, stringProperty } from './ast/literals'
import { readSourceFile } from './ast/parse'
import { schemaProperty } from './ast/schemas'
import {
  helperSourceRefsForNode,
  resolvedSourceNodeForProperty,
  sourceRefForProperty,
  sourceRefsForFactoryArguments,
  sourceRefsForObjectMapContributors,
} from './ast/source-refs'
import { sourceForNode, sourceSnippetForNode } from './ast/snippets'
import { fingerprint, safeId } from './definitions'
import { extractedFactsFromStaticExtractionResult, type IndexerExtensionRuntime } from './extensions'
import type { ExtractedFacts } from './extensions'
import { staticFoundDefinitionFromExtractedFacts } from './extensions/static-normalizer'
import type { ImportBinding, StaticFactParser, StaticFoundDefinition } from './types'
import {
  compilerIntrinsicStaticCallNames,
  createProjectIndexCompilerRuntime,
  cruxCoreCompilerProfile,
} from './compiler/profile'

/** Creates a compiler-owned fact parser bound to one extension runtime instance. */
export function createStaticFactParser(
  extensionRuntime: IndexerExtensionRuntime,
  input: {
    readonly intrinsicCallNames?: readonly string[]
  } = {},
): StaticFactParser {
  return {
    staticCallNames: new Set([...extensionRuntime.manifest.callNames, ...(input.intrinsicCallNames ?? [])]),
    staticCacheInputs: extensionRuntime.manifest.cacheInputs,
    staticFactsFromInitializer: (
      root,
      file,
      sourceFile,
      variableName,
      initializer,
      localInitializers,
      importBindings,
    ) =>
      staticFactsFromInitializer(
        extensionRuntime,
        root,
        file,
        sourceFile,
        variableName,
        initializer,
        localInitializers,
        importBindings,
      ),
    staticFactsFromCall: (root, file, sourceFile, callName, call, localInitializers, importBindings) =>
      staticFactsFromCall(extensionRuntime, root, file, sourceFile, callName, call, localInitializers, importBindings),
    staticTreePathDefinitions: (root, file, sourceFile, localInitializers, found, importBindings) =>
      staticTreePathDefinitions(extensionRuntime, root, file, sourceFile, localInitializers, found, importBindings),
    expressionName,
    hasExportModifier,
  }
}

/** Default first-party parser for compatibility callers. */
const defaultCompilerRuntime = createProjectIndexCompilerRuntime(cruxCoreCompilerProfile)

export const staticFactParser: StaticFactParser = createStaticFactParser(defaultCompilerRuntime.extensionRuntime, {
  intrinsicCallNames: compilerIntrinsicStaticCallNames(cruxCoreCompilerProfile),
})

/**
 * Extracts fact contributions from one variable initializer.
 *
 * This is the parser's main source-local dispatch point. Parser-owned special cases remain here for
 * shapes that are not normal extension calls yet, while ordinary call expressions route through the
 * extension registry with import-aware pattern matching.
 */
function staticFactsFromInitializer(
  extensionRuntime: IndexerExtensionRuntime,
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  variableName: string,
  initializer: ts.Expression,
  localInitializers: Map<string, ts.Expression>,
  importBindings = new Map<string, ImportBinding>(),
): ExtractedFacts | undefined {
  if (ts.isObjectLiteralExpression(initializer) && isToolSchemaObject(initializer)) {
    const explicitName = stringProperty(initializer, 'name')
    const id = `tool:${safeId(explicitName ?? variableName)}`
    return {
      definitions: [
        {
          variableName,
          definition: staticDefinition(
            file,
            id,
            'tool',
            explicitName ?? variableName,
            initializer,
            sourceForNode(sourceFile, initializer),
            sourceSnippetForNode(sourceFile, initializer),
            {
              exportName: variableName,
              inputSchema: schemaProperty(initializer, 'parameters', localInitializers),
            },
          ),
        },
      ],
      references: [],
    }
  }

  if (ts.isNewExpression(initializer)) {
    return staticFactsFromNewExpression(root, file, sourceFile, variableName, initializer, localInitializers)
  }

  if (!ts.isCallExpression(initializer)) return undefined
  const callName = expressionName(initializer.expression)
  if (!callName) return undefined

  const firstArg = initializer.arguments[0]
  const objectArg = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
  if (callName === 'convexAgent' && objectArg) {
    return staticFactsFromConvexAgentConfig(
      root,
      file,
      sourceFile,
      variableName,
      initializer,
      objectArg,
      localInitializers,
    )
  }
  const source = sourceForNode(sourceFile, initializer)
  const snippet = sourceSnippetForNode(sourceFile, initializer)
  const localName = fallbackStaticName(root, file, variableName)
  const importBinding = importBindings.get(callName)
  return extractedFactsFromStaticExtractionResult(
    extensionRuntime.extractStatic({
      root,
      file,
      sourceFile,
      variableName,
      call: initializer,
      callName,
      firstArg,
      objectArg,
      source,
      snippet,
      localName,
      localInitializers,
      ...(importBinding ? { importName: importBinding.importedName, importSource: importBinding.moduleSpecifier } : {}),
      helpers: {
        safeId,
        schemaProperty,
        define: (id, kind, name, objectArgValue, metadata) =>
          staticDefinition(file, id, kind, name, objectArgValue, source, snippet, metadata),
        relationRef: (type, target) => ({ type, ...target }),
      },
      safeId,
      define: (id, kind, name, objectArgValue, metadata) =>
        staticDefinition(file, id, kind, name, objectArgValue, source, snippet, metadata),
    }),
  )
}

/**
 * Extracts facts from a standalone call expression discovered outside an exported declaration.
 *
 * The generated fallback name gives local call-site definitions deterministic ids while preserving the
 * same extension dispatch path used for exported initializers.
 */
function staticFactsFromCall(
  extensionRuntime: IndexerExtensionRuntime,
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  callName: string,
  call: ts.CallExpression,
  localInitializers: Map<string, ts.Expression>,
  importBindings = new Map<string, ImportBinding>(),
): ExtractedFacts | undefined {
  const source = sourceForNode(sourceFile, call)
  const fallbackName = fallbackStaticName(root, file, `${callName}-${source.line}`)
  return staticFactsFromInitializer(
    extensionRuntime,
    root,
    file,
    sourceFile,
    fallbackName,
    call,
    localInitializers,
    importBindings,
  )
}

/**
 * Builds path-backed prompt/context definitions from `createPrompts` and `createContexts` trees.
 *
 * Tree paths are parser-owned projections that annotate existing definitions with authored path
 * information. They stay outside extractor authoring so extensions do not need to understand index
 * path backfill mechanics.
 */
async function staticTreePathDefinitions(
  extensionRuntime: IndexerExtensionRuntime,
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  localInitializers: Map<string, ts.Expression>,
  found: StaticFoundDefinition[],
  importBindings: Map<string, ImportBinding>,
): Promise<ProjectDefinition[]> {
  const localByExport = new Map(found.map((item) => [item.variableName, item.definition]))
  const definitions: ProjectDefinition[] = []

  const visit = async (node: ts.Node): Promise<void> => {
    if (ts.isCallExpression(node)) {
      const callName = expressionName(node.expression)
      if (
        (callName === 'createPrompts' || callName === 'createContexts') &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const kind: ProjectDefinitionKind = callName === 'createPrompts' ? 'prompt' : 'context'
        definitions.push(
          ...(await treePathDefinitionsForObject(
            root,
            file,
            sourceFile,
            node.arguments[0],
            [],
            kind,
            localInitializers,
            localByExport,
            importBindings,
            extensionRuntime,
          )),
        )
      }
    }
    const tasks: Promise<void>[] = []
    ts.forEachChild(node, (child) => {
      tasks.push(visit(child))
    })
    await Promise.all(tasks)
  }

  await visit(sourceFile)
  return definitions
}

/** Recursively walks an authored prompt/context tree and projects identifier leaves into path definitions. */
async function treePathDefinitionsForObject(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  object: ts.ObjectLiteralExpression,
  path: string[],
  kind: ProjectDefinitionKind,
  localInitializers: Map<string, ts.Expression>,
  localByExport: Map<string, ProjectDefinition>,
  importBindings: Map<string, ImportBinding>,
  extensionRuntime: IndexerExtensionRuntime,
): Promise<ProjectDefinition[]> {
  const definitions: ProjectDefinition[] = []
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) continue
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
    const key = propertyName(property.name)
    if (!key) continue
    const nextPath = [...path, key]
    const initializer = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer

    if (ts.isObjectLiteralExpression(initializer)) {
      definitions.push(
        ...(await treePathDefinitionsForObject(
          root,
          file,
          sourceFile,
          initializer,
          nextPath,
          kind,
          localInitializers,
          localByExport,
          importBindings,
          extensionRuntime,
        )),
      )
      continue
    }
    if (!ts.isIdentifier(initializer)) continue

    const resolved = await resolveDefinitionForTreeLeaf(
      root,
      file,
      sourceFile,
      initializer.text,
      kind,
      localInitializers,
      localByExport,
      importBindings,
      extensionRuntime,
    )
    if (!resolved) continue
    definitions.push({
      id: resolved.id,
      kind: resolved.kind,
      name: resolved.name,
      path: nextPath,
      fidelity: resolved.fidelity,
      status: resolved.status,
    })
  }
  return definitions
}

/**
 * Resolves a prompt/context tree leaf against local exports, local initializers, or imported exports.
 *
 * The function is conservative: it only returns a definition when the target kind matches the tree
 * kind, preventing path metadata from being attached to unrelated index definitions.
 */
async function resolveDefinitionForTreeLeaf(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  identifier: string,
  kind: ProjectDefinitionKind,
  localInitializers: Map<string, ts.Expression>,
  localByExport: Map<string, ProjectDefinition>,
  importBindings: Map<string, ImportBinding>,
  extensionRuntime: IndexerExtensionRuntime,
): Promise<ProjectDefinition | undefined> {
  const local = localByExport.get(identifier)
  if (local?.kind === kind) return local

  const initializer = localInitializers.get(identifier)
  if (initializer) {
    const extracted = staticFactsFromInitializer(
      extensionRuntime,
      root,
      file,
      sourceFile,
      identifier,
      initializer,
      localInitializers,
    )
    const parsed = extracted ? staticFoundDefinitionFromExtractedFacts(extracted) : undefined
    if (parsed?.definition.kind === kind) return parsed.definition
  }

  const binding = importBindings.get(identifier)
  if (!binding) return undefined
  const exports = await staticExportDefinitions(extensionRuntime, root, binding.file)
  const imported = exports.get(binding.importedName)
  return imported?.kind === kind ? imported : undefined
}

/** Reads exported static definitions from another file for tree-path and relation binding. */
async function staticExportDefinitions(
  extensionRuntime: IndexerExtensionRuntime,
  root: string,
  file: string,
): Promise<Map<string, ProjectDefinition>> {
  return readStaticExportDefinitions(extensionRuntime, root, file)
}

/** Parses one imported file and returns definitions keyed by exported variable name. */
async function readStaticExportDefinitions(
  extensionRuntime: IndexerExtensionRuntime,
  root: string,
  file: string,
): Promise<Map<string, ProjectDefinition>> {
  const sourceFile = await readSourceFile(file)
  const localInitializers = new Map<string, ts.Expression>()
  const definitions = new Map<string, ProjectDefinition>()

  collectTopLevelInitializers(sourceFile, localInitializers)

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const extracted = staticFactsFromInitializer(
        extensionRuntime,
        root,
        file,
        sourceFile,
        declaration.name.text,
        declaration.initializer,
        localInitializers,
      )
      const parsed = extracted ? staticFoundDefinitionFromExtractedFacts(extracted) : undefined
      if (parsed) definitions.set(declaration.name.text, parsed.definition)
    }
  }
  return definitions
}

/** Handles constructor-based index definitions such as `new Agent(...)`. */
function staticFactsFromNewExpression(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  variableName: string,
  initializer: ts.NewExpression,
  localInitializers: Map<string, ts.Expression>,
): ExtractedFacts | undefined {
  const callName = expressionName(initializer.expression)
  if (callName !== 'Agent') return undefined
  const objectArg = initializer.arguments?.find((arg): arg is ts.ObjectLiteralExpression =>
    ts.isObjectLiteralExpression(arg),
  )
  if (!objectArg) return undefined
  return staticFactsFromConvexAgentConfig(
    root,
    file,
    sourceFile,
    variableName,
    initializer,
    objectArg,
    localInitializers,
  )
}

/**
 * Extracts Convex agent configuration that still needs parser-owned handling.
 *
 * Convex agent configs combine prompt/tool/context handlers, source refs, and runtime joins in a shape
 * that predates the stable extractor readers. The result is still emitted as immutable facts.
 */
function staticFactsFromConvexAgentConfig(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  variableName: string,
  initializer: ts.Expression,
  objectArg: ts.ObjectLiteralExpression,
  localInitializers: Map<string, ts.Expression>,
): ExtractedFacts {
  const explicitName = stringProperty(objectArg, 'name')
  const id = `agent:${safeId(explicitName ?? fallbackStaticName(root, file, variableName))}`
  const relationRefs = [
    ...agentToolRelationRefs(objectArg, localInitializers),
    ...agentPromptRelationRefs(objectArg, localInitializers),
  ]
  const sourceRefs = convexAgentSourceRefs(root, file, sourceFile, id, objectArg, localInitializers)
  const definition = staticDefinition(
    file,
    id,
    'agent',
    explicitName ?? variableName,
    objectArg,
    sourceForNode(sourceFile, initializer),
    sourceSnippetForNode(sourceFile, initializer),
    {
      exportName: variableName,
      runtime: 'convex-agent',
      hasTools: hasProperty(objectArg, 'tools'),
      hasContextHandler: hasProperty(objectArg, 'contextHandler'),
      hasUsageHandler: hasProperty(objectArg, 'usageHandler'),
      hasPrepare: hasProperty(objectArg, 'prepare'),
      maxSteps: hasProperty(objectArg, 'maxSteps') ? 'configured' : undefined,
    },
  )
  return {
    definitions: [
      {
        variableName,
        definition: sourceRefs.length > 0 ? { ...definition, sourceRefs } : definition,
      },
    ],
    references: relationRefs,
  }
}

/** Builds unresolved tool relation refs from Convex agent tool-map configuration. */
function agentToolRelationRefs(
  object: ts.ObjectLiteralExpression,
  localInitializers: Map<string, ts.Expression>,
): Array<{ type: string; toVariable: string }> {
  const tools = propertyInitializer(object, 'tools')
  if (!tools) return []
  const initializer = resolveIdentifierExpression(toExpression(tools), localInitializers)
  if (!ts.isObjectLiteralExpression(initializer)) return []
  return initializer.properties
    .map((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return property.name.text
      if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)) return property.initializer.text
      return undefined
    })
    .filter((value): value is string => typeof value === 'string')
    .map((toVariable) => ({ type: 'agent.uses_tool', toVariable }))
}

/** Collects source refs for Convex agent config properties and contributor helpers. */
function convexAgentSourceRefs(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  definitionId: string,
  object: ts.ObjectLiteralExpression,
  localInitializers: Map<string, ts.Expression>,
) {
  const callbackProperties = ['usageHandler', 'contextHandler', 'prepare']
  const directRefs = [
    sourceRefForProperty({
      root,
      file,
      sourceFile,
      object,
      property: 'prompt',
      role: 'config',
      definitionId,
      localInitializers,
    }),
    sourceRefForProperty({
      root,
      file,
      sourceFile,
      object,
      property: 'tools',
      role: 'config',
      definitionId,
      localInitializers,
    }),
    ...callbackProperties.map((property) =>
      sourceRefForProperty({
        root,
        file,
        sourceFile,
        object,
        property,
        role: 'callback',
        definitionId,
        localInitializers,
      }),
    ),
  ].filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
  const toolsResolved = resolvedSourceNodeForProperty({
    root,
    file,
    sourceFile,
    object,
    property: 'tools',
    localInitializers,
  })
  const toolMapRefs = sourceRefsForObjectMapContributors({
    definitionId,
    property: 'tools',
    root,
    file: toolsResolved?.sourceFile.fileName ?? file,
    sourceFile: toolsResolved?.sourceFile ?? sourceFile,
    objectExpression: toolsResolved?.expression,
    localInitializers: toolsResolved?.localInitializers ?? localInitializers,
  })

  const helperRefs = ['tools', ...callbackProperties].flatMap((property) => {
    const initializer = propertyInitializer(object, property)
    const expression = initializer ? toExpression(initializer) : undefined
    if (expression && ts.isCallExpression(expression)) {
      return helperSourceRefsForNode({
        definitionId,
        root,
        file,
        sourceFile,
        node: expression,
        localInitializers,
      })
    }
    const resolved = resolvedSourceNodeForProperty({ root, file, sourceFile, object, property, localInitializers })
    if (!resolved) return []
    return helperSourceRefsForNode({
      definitionId,
      root,
      file: resolved.sourceFile.fileName,
      sourceFile: resolved.sourceFile,
      node: resolved.node,
      localInitializers: resolved.localInitializers,
    })
  })
  const factoryArgRefs = callbackProperties.flatMap((property) => {
    const initializer = propertyInitializer(object, property)
    const expression = initializer ? toExpression(initializer) : undefined
    if (expression && ts.isCallExpression(expression)) {
      return sourceRefsForFactoryArguments({
        definitionId,
        property,
        root,
        file,
        sourceFile,
        node: expression,
        localInitializers,
      })
    }
    const resolved = resolvedSourceNodeForProperty({ root, file, sourceFile, object, property, localInitializers })
    if (!resolved) return []
    return sourceRefsForFactoryArguments({
      definitionId,
      property,
      root,
      file: resolved.sourceFile.fileName,
      sourceFile: resolved.sourceFile,
      node: resolved.node,
      localInitializers: resolved.localInitializers,
    })
  })

  return dedupeSourceRefs([...directRefs, ...toolMapRefs, ...helperRefs, ...factoryArgRefs])
}

/** Builds prompt/context relation refs from Convex agent prompt resolution config. */
function agentPromptRelationRefs(
  object: ts.ObjectLiteralExpression,
  localInitializers: Map<string, ts.Expression>,
): Array<{ type: string; toVariable: string }> {
  const prompt = propertyInitializer(object, 'prompt')
  const promptExpression = prompt ? toExpression(prompt) : undefined
  if (promptExpression && ts.isIdentifier(promptExpression))
    return [{ type: 'agent.uses_prompt', toVariable: promptExpression.text }]

  const languageModel = propertyInitializer(object, 'languageModel')
  if (!languageModel || !ts.isIdentifier(toExpression(languageModel))) return []
  const initializer = resolveIdentifierExpression(toExpression(languageModel), localInitializers)
  const promptRef = promptRefFromResolveCall(initializer)
  return promptRef ? [{ type: 'agent.uses_prompt', toVariable: promptRef }] : []
}

/** Reads the prompt identifier passed through `resolve(...)` helper calls. */
function promptRefFromResolveCall(expression: ts.Expression): string | undefined {
  const candidate = ts.isAwaitExpression(expression) ? expression.expression : expression
  if (!ts.isCallExpression(candidate) || expressionName(candidate.expression) !== 'resolve') return undefined
  const [firstArg] = candidate.arguments
  return firstArg && ts.isIdentifier(firstArg) ? firstArg.text : undefined
}

/** Deduplicates source refs by stable ref id while preserving the last computed value for each id. */
function dedupeSourceRefs<T extends { id: string }>(refs: readonly T[]): T[] {
  const merged = new Map<string, T>()
  for (const ref of refs) merged.set(ref.id, ref)
  return [...merged.values()]
}

/** Resolves a property initializer, including shorthand properties and local initializer aliases. */
function propertyInitializer(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | ts.ShorthandPropertyAssignment | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === name,
  )
  if (!property) return undefined
  return ts.isShorthandPropertyAssignment(property) ? property : property.initializer
}

/** Converts shorthand properties into identifier expressions so downstream helpers can share one path. */
function toExpression(value: ts.Expression | ts.ShorthandPropertyAssignment): ts.Expression {
  return ts.isShorthandPropertyAssignment(value) ? value.name : value
}

/**
 * Builds a Project Index definition with parser-owned defaults.
 *
 * The helper centralizes source ranges, snippets, fidelity/status defaults, and runtime join metadata
 * so parser special cases and extension builders emit definitions with the same index shape.
 */
function staticDefinition(
  file: string,
  id: string,
  kind: ProjectDefinitionKind,
  name: string,
  objectArg: ts.ObjectLiteralExpression | undefined,
  source: SourceLocation,
  sourceSnippetValue: SourceSnippet | undefined,
  metadata: Record<string, unknown>,
): ProjectDefinition {
  const tags = objectArg ? stringArrayProperty(objectArg, 'tags') : undefined
  return {
    id,
    kind,
    name,
    description: objectArg ? stringProperty(objectArg, 'description') : undefined,
    tags,
    source,
    sourceSnippet: sourceSnippetValue,
    fidelity: 'resolved',
    status: 'active',
    fingerprint: fingerprint({ kind, name, file, text: sourceSnippetValue?.source }),
    metadata: {
      ...runtimeJoinMetadata(id, kind, name, metadata),
      ...metadata,
      static: true,
    },
  }
}

/** Builds a static Project Index definition with the same metadata defaults as parser extraction. */
export function staticDefinitionForTesting(
  file: string,
  id: string,
  kind: ProjectDefinitionKind,
  name: string,
  objectArg: ts.ObjectLiteralExpression | undefined,
  source: SourceLocation,
  sourceSnippetValue: SourceSnippet | undefined,
  metadata: Record<string, unknown>,
): ProjectDefinition {
  return staticDefinition(file, id, kind, name, objectArg, source, sourceSnippetValue, metadata)
}

/** Computes authored-to-runtime join hints for definition kinds that can be correlated with spans. */
function runtimeJoinMetadata(
  id: string,
  kind: ProjectDefinitionKind,
  name: string,
  metadata: Record<string, unknown>,
): { runtimeJoin: ProjectRuntimeJoin } {
  const spanAttributes: Record<string, string> = {}
  const runtimeJoin: ProjectRuntimeJoin = {
    definitionId: id,
    kind,
    name,
    spanAttributes,
  }

  switch (kind) {
    case 'prompt':
      runtimeJoin.primitive = 'prompt.resolve'
      spanAttributes.promptId = id.slice('prompt:'.length)
      runtimeJoin.promptId = spanAttributes.promptId
      break
    case 'context':
      runtimeJoin.primitive = 'context.resolve'
      spanAttributes.contextId = id.slice('context:'.length)
      runtimeJoin.contextId = spanAttributes.contextId
      break
    case 'tool':
      runtimeJoin.primitive = 'tool.call'
      spanAttributes.toolName = name
      runtimeJoin.toolName = name
      break
    case 'agent':
      runtimeJoin.primitive = 'agent.run'
      runtimeJoin.spanName = name
      spanAttributes.agentId = String(metadata.agentId ?? id.slice('agent:'.length))
      runtimeJoin.agentId = spanAttributes.agentId
      break
    case 'flow':
      runtimeJoin.primitive = 'flow.run'
      runtimeJoin.spanName = name
      runtimeJoin.correlationAttributes = ['flowId', 'parentFlowId']
      break
    case 'flow.step':
      runtimeJoin.primitive = 'flow.step'
      runtimeJoin.spanName = name
      runtimeJoin.stepLabel = name
      spanAttributes.stepLabel = name
      if (typeof metadata.flowId === 'string') {
        runtimeJoin.parentDefinitionId = metadata.flowId
        runtimeJoin.flowName = stripDefinitionPrefix(metadata.flowId, 'flow:')
      }
      runtimeJoin.correlationAttributes = ['flowId', 'stepId']
      break
    case 'routing.router':
      runtimeJoin.primitive = 'routing.router'
      runtimeJoin.spanName = name
      spanAttributes.routingId = String(metadata.routingId ?? stripDefinitionPrefix(id, 'routing.router:'))
      runtimeJoin.routingId = spanAttributes.routingId
      runtimeJoin.correlationAttributes = ['routingId']
      break
    case 'routing.router.route':
      runtimeJoin.primitive = 'routing.router'
      runtimeJoin.spanName = name
      spanAttributes.routingId = String(
        metadata.routingId ?? stripDefinitionPrefix(String(metadata.routerDefinitionId ?? ''), 'routing.router:'),
      )
      spanAttributes.classifiedAs = String(metadata.routeKey ?? name)
      runtimeJoin.routingId = spanAttributes.routingId
      runtimeJoin.routeKey = spanAttributes.classifiedAs
      if (typeof metadata.routerDefinitionId === 'string') {
        runtimeJoin.parentDefinitionId = metadata.routerDefinitionId
      }
      runtimeJoin.correlationAttributes = ['routingId', 'classifiedAs']
      break
    case 'routing.cascade':
      runtimeJoin.primitive = 'routing.cascade'
      runtimeJoin.spanName = name
      spanAttributes.routingId = String(metadata.routingId ?? stripDefinitionPrefix(id, 'routing.cascade:'))
      runtimeJoin.routingId = spanAttributes.routingId
      runtimeJoin.correlationAttributes = ['routingId']
      break
    case 'routing.cascade.tier':
      runtimeJoin.primitive = 'routing.cascade'
      runtimeJoin.spanName = name
      spanAttributes.routingId = String(
        metadata.routingId ?? stripDefinitionPrefix(String(metadata.cascadeDefinitionId ?? ''), 'routing.cascade:'),
      )
      if (typeof metadata.tierIndex === 'number') spanAttributes.tierIndex = String(metadata.tierIndex)
      if (typeof metadata.cascadeDefinitionId === 'string') {
        runtimeJoin.parentDefinitionId = metadata.cascadeDefinitionId
      }
      runtimeJoin.routingId = spanAttributes.routingId
      runtimeJoin.correlationAttributes = ['routingId', 'tierIndex']
      break
    case 'routing.fallback':
      runtimeJoin.primitive = 'fallback.attempt'
      runtimeJoin.spanName = name
      spanAttributes.routingId = String(metadata.routingId ?? (stripDefinitionPrefix(id, 'routing.fallback:') || name))
      runtimeJoin.routingId = spanAttributes.routingId
      runtimeJoin.correlationAttributes = ['routingId']
      break
    case 'routing.fallback.option':
      runtimeJoin.primitive = 'fallback.attempt'
      runtimeJoin.spanName = name
      if (typeof metadata.routingId === 'string') {
        spanAttributes.routingId = metadata.routingId
        runtimeJoin.routingId = metadata.routingId
      }
      if (typeof metadata.optionIndex === 'number') spanAttributes.attempt = String(metadata.optionIndex + 1)
      if (typeof metadata.fallbackDefinitionId === 'string') {
        runtimeJoin.parentDefinitionId = metadata.fallbackDefinitionId
      }
      runtimeJoin.correlationAttributes = ['routingId', 'attempt']
      break
    case 'memory':
      runtimeJoin.primitive = 'memory.*'
      spanAttributes.memoryId = stripDefinitionPrefix(id, 'memory:')
      spanAttributes.sourceDefinitionId = id
      runtimeJoin.memoryId = spanAttributes.memoryId
      runtimeJoin.sourceDefinitionId = id
      if (typeof metadata.runtimeIdPrefix === 'string') runtimeJoin.runtimeIdPrefix = metadata.runtimeIdPrefix
      break
    case 'memory.store':
      runtimeJoin.resource = 'memory.store'
      runtimeJoin.memoryStoreId = stripDefinitionPrefix(id, 'memory.store:')
      if (typeof metadata.backend === 'string') runtimeJoin.backend = metadata.backend
      break
    case 'memory.block':
      runtimeJoin.primitive = 'memory.*'
      runtimeJoin.blockDefinitionId = id
      spanAttributes.blockDefinitionId = id
      if (typeof metadata.memoryId === 'string') {
        spanAttributes.sourceDefinitionId = metadata.memoryId
        spanAttributes.memoryId = stripDefinitionPrefix(metadata.memoryId, 'memory:')
        runtimeJoin.sourceDefinitionId = metadata.memoryId
        runtimeJoin.memoryId = spanAttributes.memoryId
      }
      if (typeof metadata.blockId === 'string') {
        spanAttributes.blockId = metadata.blockId
        runtimeJoin.blockId = metadata.blockId
      }
      if (typeof metadata.blockKind === 'string') {
        spanAttributes.blockKind = metadata.blockKind
        runtimeJoin.blockKind = metadata.blockKind
      }
      break
    case 'blackboard':
      runtimeJoin.primitive = 'memory.*'
      spanAttributes.memoryId = stripDefinitionPrefix(id, 'blackboard:')
      spanAttributes.blockId = spanAttributes.memoryId
      spanAttributes.memoryType = 'blackboard'
      spanAttributes.sourceDefinitionId = id
      runtimeJoin.memoryId = spanAttributes.memoryId
      runtimeJoin.blockId = spanAttributes.blockId
      runtimeJoin.sourceDefinitionId = id
      if (typeof metadata.runtimeIdPrefix === 'string') runtimeJoin.runtimeIdPrefix = metadata.runtimeIdPrefix
      break
    case 'rag.retriever':
      runtimeJoin.primitive = 'retrieval.*'
      spanAttributes.retrieverId = id.slice('rag.retriever:'.length)
      runtimeJoin.retrieverId = spanAttributes.retrieverId
      break
    case 'rag.pipeline':
      runtimeJoin.primitive = 'rag.pipeline'
      spanAttributes.ragPipelineId = id.slice('rag.pipeline:'.length)
      runtimeJoin.ragPipelineId = spanAttributes.ragPipelineId
      break
    case 'workspace':
      runtimeJoin.primitive = 'workspace.operation'
      spanAttributes.workspaceId = id.slice('workspace:'.length)
      runtimeJoin.workspaceId = spanAttributes.workspaceId
      break
  }

  return { runtimeJoin }
}

/** Removes a index id prefix when deriving runtime join names from definition ids. */
function stripDefinitionPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

/** Checks whether a variable statement should be treated as an exported index declaration. */
function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  )
}

/** Reads the callable or property name represented by a TypeScript expression. */
function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

/** Resolves one local identifier alias before parser-owned source-ref or schema projection. */
function resolveIdentifierExpression(
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression {
  return ts.isIdentifier(expression) ? (localInitializers.get(expression.text) ?? expression) : expression
}

/** Detects object-literal tool schemas that are authored without a `tool(...)` wrapper. */
function isToolSchemaObject(object: ts.ObjectLiteralExpression): boolean {
  return Boolean(
    stringProperty(object, 'name') && stringProperty(object, 'description') && hasProperty(object, 'parameters'),
  )
}

/** Builds a deterministic local fallback name from file path and variable/call-site name. */
function fallbackStaticName(root: string, file: string, variableName: string): string {
  return `${relative(root, file).replace(/\\/g, '/')}:${variableName}`
}
