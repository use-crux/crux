import { relative } from 'node:path'
import ts from 'typescript'
import type {
  ProjectDefinition,
  ProjectDefinitionKind,
  SourceLocation,
  SourceSnippet,
} from '@crux/core/catalog'
import { collectTopLevelInitializers } from './ast/initializers'
import { hasProperty, propertyName, stringArrayProperty, stringProperty } from './ast/literals'
import { readSourceFile } from './ast/parse'
import { schemaProperty } from './ast/schemas'
import { helperSourceRefsForNode, resolvedSourceNodeForProperty, sourceRefForProperty, sourceRefsForFactoryArguments, sourceRefsForObjectMapContributors } from './ast/source-refs'
import { sourceForNode, sourceSnippetForNode } from './ast/snippets'
import { fingerprint, safeId } from './definitions'
import { extractWithRegistry } from './extractors/registry'
import type { ImportBinding, StaticFileParser, StaticFoundDefinition } from './types'

export const staticFileParser: StaticFileParser = {
  staticDefinitionFromInitializer,
  staticDefinitionFromCall,
  staticTreePathDefinitions,
  expressionName,
  hasExportModifier,
}

async function staticTreePathDefinitions(
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

async function resolveDefinitionForTreeLeaf(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  identifier: string,
  kind: ProjectDefinitionKind,
  localInitializers: Map<string, ts.Expression>,
  localByExport: Map<string, ProjectDefinition>,
  importBindings: Map<string, ImportBinding>,
): Promise<ProjectDefinition | undefined> {
  const local = localByExport.get(identifier)
  if (local?.kind === kind) return local

  const initializer = localInitializers.get(identifier)
  if (initializer) {
    const parsed = staticDefinitionFromInitializer(root, file, sourceFile, identifier, initializer, localInitializers)
    if (parsed?.definition.kind === kind) return parsed.definition
  }

  const binding = importBindings.get(identifier)
  if (!binding) return undefined
  const exports = await staticExportDefinitions(root, binding.file)
  const imported = exports.get(binding.importedName)
  return imported?.kind === kind ? imported : undefined
}

async function staticExportDefinitions(root: string, file: string): Promise<Map<string, ProjectDefinition>> {
  return readStaticExportDefinitions(root, file)
}

async function readStaticExportDefinitions(root: string, file: string): Promise<Map<string, ProjectDefinition>> {
  const sourceFile = await readSourceFile(file)
  const localInitializers = new Map<string, ts.Expression>()
  const definitions = new Map<string, ProjectDefinition>()

  collectTopLevelInitializers(sourceFile, localInitializers)

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const parsed = staticDefinitionFromInitializer(
        root,
        file,
        sourceFile,
        declaration.name.text,
        declaration.initializer,
        localInitializers,
      )
      if (parsed) definitions.set(declaration.name.text, parsed.definition)
    }
  }
  return definitions
}

function staticDefinitionFromInitializer(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  variableName: string,
  initializer: ts.Expression,
  localInitializers: Map<string, ts.Expression>,
): StaticFoundDefinition | undefined {
  if (ts.isObjectLiteralExpression(initializer) && isToolSchemaObject(initializer)) {
    const explicitName = stringProperty(initializer, 'name')
    const id = `tool:${safeId(explicitName ?? variableName)}`
    return {
      variableName,
      relationRefs: [],
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
    }
  }

  if (ts.isNewExpression(initializer)) {
    return staticDefinitionFromNewExpression(root, file, sourceFile, variableName, initializer, localInitializers)
  }

  if (!ts.isCallExpression(initializer)) return undefined
  const callName = expressionName(initializer.expression)
  if (!callName) return undefined

  const firstArg = initializer.arguments[0]
  const objectArg = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
  const source = sourceForNode(sourceFile, initializer)
  const snippet = sourceSnippetForNode(sourceFile, initializer)
  const localName = fallbackStaticName(root, file, variableName)
  const registryFound = extractWithRegistry({
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
  })
  if (registryFound) return registryFound
  return undefined
}

function staticDefinitionFromNewExpression(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  variableName: string,
  initializer: ts.NewExpression,
  localInitializers: Map<string, ts.Expression>,
): StaticFoundDefinition | undefined {
  const callName = expressionName(initializer.expression)
  if (callName !== 'Agent') return undefined
  const objectArg = initializer.arguments?.find((arg): arg is ts.ObjectLiteralExpression =>
    ts.isObjectLiteralExpression(arg),
  )
  if (!objectArg) return undefined
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
      maxSteps: hasProperty(objectArg, 'maxSteps') ? 'configured' : undefined,
    },
  )
  return {
    variableName,
    relationRefs,
    definition: sourceRefs.length > 0 ? { ...definition, sourceRefs } : definition,
  }
}

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

function convexAgentSourceRefs(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  definitionId: string,
  object: ts.ObjectLiteralExpression,
  localInitializers: Map<string, ts.Expression>,
) {
  const directRefs = [
    sourceRefForProperty({ root, file, sourceFile, object, property: 'tools', role: 'config', definitionId, localInitializers }),
    sourceRefForProperty({ root, file, sourceFile, object, property: 'usageHandler', role: 'callback', definitionId, localInitializers }),
    sourceRefForProperty({ root, file, sourceFile, object, property: 'contextHandler', role: 'callback', definitionId, localInitializers }),
  ].filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
  const toolsResolved = resolvedSourceNodeForProperty({ root, file, sourceFile, object, property: 'tools', localInitializers })
  const toolMapRefs = sourceRefsForObjectMapContributors({
    definitionId,
    property: 'tools',
    root,
    file: toolsResolved?.sourceFile.fileName ?? file,
    sourceFile: toolsResolved?.sourceFile ?? sourceFile,
    objectExpression: toolsResolved?.expression,
    localInitializers: toolsResolved?.localInitializers ?? localInitializers,
  })

  const helperRefs = ['tools', 'usageHandler', 'contextHandler'].flatMap((property) => {
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
  const factoryArgRefs = ['usageHandler', 'contextHandler'].flatMap((property) => {
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

function promptRefFromResolveCall(expression: ts.Expression): string | undefined {
  const candidate = ts.isAwaitExpression(expression) ? expression.expression : expression
  if (!ts.isCallExpression(candidate) || expressionName(candidate.expression) !== 'resolve') return undefined
  const [firstArg] = candidate.arguments
  return firstArg && ts.isIdentifier(firstArg) ? firstArg.text : undefined
}

function dedupeSourceRefs<T extends { id: string }>(refs: readonly T[]): T[] {
  const merged = new Map<string, T>()
  for (const ref of refs) merged.set(ref.id, ref)
  return [...merged.values()]
}

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

function toExpression(value: ts.Expression | ts.ShorthandPropertyAssignment): ts.Expression {
  return ts.isShorthandPropertyAssignment(value) ? value.name : value
}

function staticDefinitionFromCall(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  callName: string,
  call: ts.CallExpression,
  localInitializers: Map<string, ts.Expression>,
): StaticFoundDefinition | undefined {
  const source = sourceForNode(sourceFile, call)
  const fallbackName = fallbackStaticName(root, file, `${callName}-${source.line}`)
  const parsed = staticDefinitionFromInitializer(root, file, sourceFile, fallbackName, call, localInitializers)
  if (parsed) return parsed
  return undefined
}

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
    fidelity: 'partial',
    status: 'active',
    fingerprint: fingerprint({ kind, name, file, text: sourceSnippetValue?.source }),
    metadata: {
      ...runtimeJoinMetadata(id, kind, name, metadata),
      ...metadata,
      static: true,
    },
  }
}

function runtimeJoinMetadata(
  id: string,
  kind: ProjectDefinitionKind,
  name: string,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const spanAttributes: Record<string, string> = {
    'crux.catalog.definition_id': id,
    'crux.catalog.kind': kind,
  }
  const runtimeJoin: Record<string, unknown> = {
    definitionId: id,
    kind,
    name,
    spanAttributes,
  }

  switch (kind) {
    case 'prompt':
      spanAttributes.promptId = id.slice('prompt:'.length)
      runtimeJoin.promptId = spanAttributes.promptId
      break
    case 'context':
      spanAttributes.contextId = id.slice('context:'.length)
      runtimeJoin.contextId = spanAttributes.contextId
      break
    case 'tool':
      spanAttributes.toolName = name
      runtimeJoin.toolName = name
      break
    case 'agent':
      spanAttributes.agentId = String(metadata.agentId ?? id.slice('agent:'.length))
      runtimeJoin.agentId = spanAttributes.agentId
      break
    case 'flow':
      spanAttributes.flowId = String(metadata.flowId ?? id.slice('flow:'.length))
      runtimeJoin.flowId = spanAttributes.flowId
      break
    case 'flow.step':
      if (typeof metadata.flowId === 'string') {
        spanAttributes.flowId = metadata.flowId
        runtimeJoin.flowId = metadata.flowId
      }
      spanAttributes.stepId = String(metadata.stepId ?? name)
      runtimeJoin.stepId = spanAttributes.stepId
      break
    case 'memory':
      spanAttributes.memoryId = id.slice('memory:'.length)
      runtimeJoin.memoryId = spanAttributes.memoryId
      if (typeof metadata.runtimeIdPrefix === 'string') runtimeJoin.runtimeIdPrefix = metadata.runtimeIdPrefix
      break
    case 'memory.store':
      spanAttributes.memoryStoreId = id.slice('memory.store:'.length)
      runtimeJoin.memoryStoreId = spanAttributes.memoryStoreId
      if (typeof metadata.backend === 'string') runtimeJoin.backend = metadata.backend
      break
    case 'memory.block':
      if (typeof metadata.memoryId === 'string') {
        spanAttributes.memoryId = metadata.memoryId
        runtimeJoin.memoryId = metadata.memoryId
      }
      if (typeof metadata.blockId === 'string') {
        spanAttributes.memoryBlockId = metadata.blockId
        runtimeJoin.blockId = metadata.blockId
      }
      break
    case 'blackboard':
      spanAttributes.blackboardId = id.slice('blackboard:'.length)
      runtimeJoin.blackboardId = spanAttributes.blackboardId
      if (typeof metadata.runtimeIdPrefix === 'string') runtimeJoin.runtimeIdPrefix = metadata.runtimeIdPrefix
      break
    case 'rag.retriever':
      spanAttributes.retrieverId = id.slice('rag.retriever:'.length)
      runtimeJoin.retrieverId = spanAttributes.retrieverId
      break
    case 'rag.pipeline':
      spanAttributes.ragPipelineId = id.slice('rag.pipeline:'.length)
      runtimeJoin.ragPipelineId = spanAttributes.ragPipelineId
      break
    case 'workspace':
      spanAttributes.workspaceId = id.slice('workspace:'.length)
      runtimeJoin.workspaceId = spanAttributes.workspaceId
      break
  }

  return { runtimeJoin }
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  )
}

function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

function resolveIdentifierExpression(
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression {
  return ts.isIdentifier(expression) ? (localInitializers.get(expression.text) ?? expression) : expression
}

function isToolSchemaObject(object: ts.ObjectLiteralExpression): boolean {
  return Boolean(
    stringProperty(object, 'name') && stringProperty(object, 'description') && hasProperty(object, 'parameters'),
  )
}

function fallbackStaticName(root: string, file: string, variableName: string): string {
  return `${relative(root, file).replace(/\\/g, '/')}:${variableName}`
}
