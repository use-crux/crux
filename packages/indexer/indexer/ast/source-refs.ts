import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type { JsonSchema, ProjectSourceRef, ProjectSourceRefRole, SourceLocation, SourceSnippet } from '@use-crux/core/project-index'
import { collectTopLevelInitializers, scopedInitializersForNode } from './initializers'
import { collectImportBindings } from './imports'
import { propertyName } from './literals'
import { expressionToJsonSchema } from './schemas'
import { sourceForNode, sourceSnippetForNode } from './snippets'

export interface ResolvedSourceNode {
  readonly symbol: string
  readonly node: ts.Node
  readonly expression?: ts.Expression
  readonly sourceFile: ts.SourceFile
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
  readonly source: SourceLocation
  readonly snippet: SourceSnippet
  readonly functionName?: string
}

export function schemaPropertyWithSourceRef(input: {
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly object: ts.ObjectLiteralExpression
  readonly property: string
  readonly definitionId: string
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
}): { schema?: JsonSchema; sourceRefs: ProjectSourceRef[] } {
  const initializer = propertyInitializer(input.object, input.property)
  if (!initializer) return { sourceRefs: [] }

  const schema = expressionToJsonSchema(initializer, input.localInitializers)
  const resolved = ts.isIdentifier(initializer)
    ? resolveIdentifierSourceNode(input.root, input.file, input.sourceFile, initializer.text, input.localInitializers)
    : undefined
  const resolvedSchema = resolved?.expression ? expressionToJsonSchema(resolved.expression, resolved.localInitializers) : undefined
  const finalSchema = schema ?? resolvedSchema
  const sourceRefs = resolved
    ? [
        projectSourceRef({
          definitionId: input.definitionId,
          role: 'schema',
          property: input.property,
          resolved,
          metadata: {
            schemaKind: schemaKind(resolved.expression),
            parsedSchema: Boolean(finalSchema),
          },
        }),
        ...nestedSchemaSourceRefs({
          ...input,
          file: resolved.sourceFile.fileName,
          sourceFile: resolved.sourceFile,
          localInitializers: resolved.localInitializers,
          expression: resolved.expression,
          rootSymbol: resolved.symbol,
          finalSchema,
        }),
      ]
    : []
  return { schema: finalSchema, sourceRefs }
}

export function callbackSourceRefForProperty(input: {
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly object: ts.ObjectLiteralExpression
  readonly property: string
  readonly role: ProjectSourceRefRole
  readonly definitionId: string
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
}): ProjectSourceRef | undefined {
  const initializer = propertyInitializer(input.object, input.property)
  if (!initializer || !ts.isIdentifier(initializer)) return undefined
  const resolved = resolveIdentifierSourceNode(input.root, input.file, input.sourceFile, initializer.text, input.localInitializers)
  if (!resolved || !isCallbackLike(resolved.node)) return undefined
  return projectSourceRef({
    definitionId: input.definitionId,
    role: input.role,
    property: input.property,
    resolved,
  })
}

export function sourceRefForProperty(input: {
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly object: ts.ObjectLiteralExpression
  readonly property: string
  readonly role: ProjectSourceRefRole
  readonly definitionId: string
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
  readonly metadata?: ProjectSourceRef['metadata']
}): ProjectSourceRef | undefined {
  const initializer = propertyInitializer(input.object, input.property)
  if (!initializer || !ts.isIdentifier(initializer)) return undefined
  const resolved = resolveIdentifierSourceNode(input.root, input.file, input.sourceFile, initializer.text, input.localInitializers)
  if (!resolved) return undefined
  return projectSourceRef({
    definitionId: input.definitionId,
    role: input.role,
    property: input.property,
    resolved,
    metadata: input.metadata,
  })
}

export function sourceRefsForTemplateInterpolations(input: {
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly object: ts.ObjectLiteralExpression
  readonly property: string
  readonly role: ProjectSourceRefRole
  readonly definitionId: string
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
}): ProjectSourceRef[] {
  const initializer = propertyInitializer(input.object, input.property)
  if (!initializer || !ts.isTemplateExpression(initializer)) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>()
  for (const span of initializer.templateSpans) {
    const expression = unwrapExpression(span.expression)
    const resolved = resolveExpressionSourceNode(input.root, input.file, input.sourceFile, expression, input.localInitializers)
    if (!resolved || seen.has(resolved.symbol)) continue
    seen.add(resolved.symbol)
    refs.push(
      projectSourceRef({
        definitionId: input.definitionId,
        role: input.role,
        property: input.property,
        resolved,
        metadata: { injected: true, fragment: isFragmentLike(resolved.expression) },
      }),
    )
  }
  return refs
}

export function sourceRefsForObjectMapContributors(input: {
  readonly definitionId: string
  readonly property: string
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly objectExpression: ts.Expression | undefined
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
}): ProjectSourceRef[] {
  const expression = input.objectExpression ? unwrapExpression(input.objectExpression) : undefined
  const object = expression && ts.isObjectLiteralExpression(expression) ? expression : undefined
  if (!object) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>()
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      const expression = unwrapExpression(property.expression)
      if (!ts.isIdentifier(expression)) continue
      const resolved = resolveIdentifierSourceNode(input.root, input.file, input.sourceFile, expression.text, input.localInitializers)
      if (!resolved || seen.has(`spread:${resolved.symbol}`)) continue
      seen.add(`spread:${resolved.symbol}`)
      refs.push(projectSourceRef({
        definitionId: input.definitionId,
        role: 'config',
        property: input.property,
        resolved,
        metadata: { toolMapContributor: 'spread' },
      }))
      continue
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      const resolved = resolveIdentifierSourceNode(input.root, input.file, input.sourceFile, property.name.text, input.localInitializers)
      if (!resolved || seen.has(`property:${resolved.symbol}`)) continue
      seen.add(`property:${resolved.symbol}`)
      refs.push(projectSourceRef({
        definitionId: input.definitionId,
        role: 'config',
        property: input.property,
        resolved,
        metadata: { toolMapContributor: 'property' },
      }))
      continue
    }
    if (ts.isPropertyAssignment(property)) {
      const initializer = unwrapExpression(property.initializer)
      if (!ts.isIdentifier(initializer)) continue
      const resolved = resolveIdentifierSourceNode(input.root, input.file, input.sourceFile, initializer.text, input.localInitializers)
      if (!resolved || seen.has(`property:${resolved.symbol}`)) continue
      seen.add(`property:${resolved.symbol}`)
      refs.push(projectSourceRef({
        definitionId: input.definitionId,
        role: 'config',
        property: input.property,
        resolved,
        metadata: { toolMapContributor: 'property' },
      }))
    }
  }
  return refs
}

export function sourceRefsForFactoryArguments(input: {
  readonly definitionId: string
  readonly property: string
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly node: ts.Node
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
}): ProjectSourceRef[] {
  const expression = ts.isCallExpression(input.node) ? input.node : undefined
  if (!expression || !ts.isCallExpression(expression)) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>()
  expression.arguments.forEach((argument, index) => {
    const expression = unwrapExpression(argument)
    if (!ts.isIdentifier(expression)) return
    const resolved = resolveIdentifierSourceNode(input.root, input.file, input.sourceFile, expression.text, input.localInitializers)
    if (!resolved || seen.has(resolved.symbol)) return
    seen.add(resolved.symbol)
    refs.push(projectSourceRef({
      definitionId: input.definitionId,
      role: 'config',
      property: input.property,
      resolved,
      metadata: { factoryArg: true, argumentIndex: index, argumentName: expression.text },
    }))
  })
  return refs
}

export function resolvedSourceNodeForProperty(input: {
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly object: ts.ObjectLiteralExpression
  readonly property: string
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
}): ResolvedSourceNode | undefined {
  const initializer = propertyInitializer(input.object, input.property)
  if (!initializer || !ts.isIdentifier(initializer)) return undefined
  return resolveIdentifierSourceNode(input.root, input.file, input.sourceFile, initializer.text, input.localInitializers)
}

export function resolveIdentifierSourceNode(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  symbol: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
  seen = new Set<string>(),
): ResolvedSourceNode | undefined {
  const key = `${file}:${symbol}`
  if (seen.has(key)) return undefined
  seen.add(key)

  const local = resolveLocalIdentifierSourceNode(sourceFile, symbol, localInitializers)
  if (local) return local

  const binding = collectImportBindings(sourceFile, root, file).get(symbol)
  if (!binding) return undefined
  const importedSourceFile = readImportedSourceFile(binding.file)
  if (!importedSourceFile) return undefined
  const importedInitializers = new Map<string, ts.Expression>()
  collectTopLevelInitializers(importedSourceFile, importedInitializers)
  const imported = resolveLocalIdentifierSourceNode(importedSourceFile, binding.importedName, importedInitializers)
  if (imported) return imported

  return undefined
}

function resolveExpressionSourceNode(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ResolvedSourceNode | undefined {
  if (ts.isIdentifier(expression)) {
    return resolveIdentifierSourceNode(root, file, sourceFile, expression.text, localInitializers)
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return resolvePropertyAccessSourceNode(root, file, sourceFile, expression, localInitializers)
  }
  return undefined
}

function resolvePropertyAccessSourceNode(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  expression: ts.PropertyAccessExpression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ResolvedSourceNode | undefined {
  const path = propertyAccessPath(expression)
  if (path.length < 2) return undefined
  const [rootSymbol, ...properties] = path
  const rootResolved = resolveIdentifierSourceNode(root, file, sourceFile, rootSymbol, localInitializers)
  if (!rootResolved?.expression) return undefined
  let current: ts.Expression = unwrapExpression(rootResolved.expression)
  const currentSourceFile = rootResolved.sourceFile
  const currentInitializers = rootResolved.localInitializers
  let propertyNode: ts.Expression | undefined
  for (const property of properties) {
    if (!ts.isObjectLiteralExpression(current)) return undefined
    const assignment = current.properties.find(
      (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === property,
    )
    if (!assignment) return undefined
    propertyNode = assignment.initializer
    current = unwrapExpression(assignment.initializer)
  }
  if (!propertyNode) return undefined
  return {
    symbol: path.join('.'),
    node: propertyNode,
    expression: propertyNode,
    sourceFile: currentSourceFile,
    localInitializers: currentInitializers,
    source: sourceForNode(currentSourceFile, propertyNode),
    snippet: sourceSnippetForNode(currentSourceFile, propertyNode),
    functionName: functionNameForNode(propertyNode, path.at(-1) ?? path.join('.')),
  }
}

function resolveLocalIdentifierSourceNode(
  sourceFile: ts.SourceFile,
  symbol: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ResolvedSourceNode | undefined {
  const expression = localInitializers.get(symbol)
  if (expression) {
    return {
      symbol,
      node: expression,
      expression,
      sourceFile,
      localInitializers,
      source: sourceForNode(sourceFile, expression),
      snippet: sourceSnippetForNode(sourceFile, expression),
      functionName: functionNameForNode(expression, symbol),
    }
  }

  const declaration = findFunctionDeclaration(sourceFile, symbol)
  if (!declaration) return undefined
  return {
    symbol,
    node: declaration,
    sourceFile,
    localInitializers: scopedInitializersForNode(declaration, new Map(localInitializers)),
    source: {
      ...sourceForNode(sourceFile, declaration),
      function: symbol,
    },
    snippet: sourceSnippetForNode(sourceFile, declaration),
    functionName: symbol,
  }
}

export function helperSourceRefsForNode(input: {
  readonly definitionId: string
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly node: ts.Node
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
  readonly maxDepth?: number
}): ProjectSourceRef[] {
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>()
  collectHelperSourceRefs(input.node, input, input.localInitializers, refs, seen, input.maxDepth ?? 1)
  return refs
}

export function projectSourceRef(input: {
  readonly definitionId: string
  readonly role: ProjectSourceRefRole
  readonly property: string
  readonly resolved: ResolvedSourceNode
  readonly metadata?: ProjectSourceRef['metadata']
}): ProjectSourceRef {
  const source = input.resolved.functionName
    ? { ...input.resolved.source, function: input.resolved.functionName }
    : input.resolved.source
  return {
    id: `${input.definitionId}:source:${input.role}:${input.property}:${input.resolved.symbol}`,
    role: input.role,
    property: input.property,
    symbol: input.resolved.symbol,
    source,
    snippet: input.resolved.snippet,
    fidelity: 'resolved',
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }
}

function collectHelperSourceRefs(
  node: ts.Node,
  input: {
    readonly definitionId: string
    readonly root: string
    readonly file: string
    readonly sourceFile: ts.SourceFile
  },
  localInitializers: ReadonlyMap<string, ts.Expression>,
  refs: ProjectSourceRef[],
  seen: Set<string>,
  depth: number,
): void {
  if (depth <= 0) return
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      const symbol = child.expression.text
      if (!seen.has(symbol)) {
        seen.add(symbol)
        const resolved = resolveIdentifierSourceNode(input.root, input.file, input.sourceFile, symbol, localInitializers)
        if (resolved && isCallbackLike(resolved.node)) {
          refs.push(projectSourceRef({ definitionId: input.definitionId, role: 'helper', property: symbol, resolved }))
          collectHelperSourceRefs(resolved.node, input, resolved.localInitializers, refs, seen, depth - 1)
        }
      }
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
}

function propertyInitializer(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === name,
  )
  if (!property) return undefined
  return ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression
  }
  return current
}

function nestedSchemaSourceRefs(input: {
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly definitionId: string
  readonly property: string
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
  readonly expression?: ts.Expression
  readonly rootSymbol: string
  readonly finalSchema?: JsonSchema
}): ProjectSourceRef[] {
  if (!input.expression) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>([input.rootSymbol])
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const symbol = node.text
      if (!seen.has(symbol) && !isKnownLibraryIdentifier(symbol)) {
        const resolved = resolveIdentifierSourceNode(input.root, input.file, input.sourceFile, symbol, input.localInitializers)
        if (resolved?.expression && schemaKind(resolved.expression)) {
          seen.add(symbol)
          refs.push(
            projectSourceRef({
              definitionId: input.definitionId,
              role: 'schema',
              property: input.property,
              resolved,
              metadata: {
                schemaKind: schemaKind(resolved.expression),
                parsedSchema: Boolean(expressionToJsonSchema(resolved.expression, resolved.localInitializers)),
                nested: true,
              },
            }),
          )
          ts.forEachChild(resolved.expression, visit)
        }
      }
      return
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(input.expression, visit)
  return refs
}

function propertyAccessPath(expression: ts.PropertyAccessExpression): string[] {
  const path: string[] = [expression.name.text]
  let current = expression.expression
  while (ts.isPropertyAccessExpression(current)) {
    path.unshift(current.name.text)
    current = current.expression
  }
  if (ts.isIdentifier(current)) path.unshift(current.text)
  return path
}

function isKnownLibraryIdentifier(symbol: string): boolean {
  return symbol === 'z' || symbol === 'v'
}

function isFragmentLike(expression: ts.Expression | undefined): boolean {
  if (!expression) return false
  const unwrapped = unwrapExpression(expression)
  return ts.isStringLiteralLike(unwrapped) || ts.isTemplateExpression(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)
}

function findFunctionDeclaration(sourceFile: ts.SourceFile, symbol: string): ts.FunctionDeclaration | undefined {
  let found: ts.FunctionDeclaration | undefined
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isFunctionDeclaration(node) && node.name?.text === symbol) {
      found = node
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function readImportedSourceFile(file: string): ts.SourceFile | undefined {
  try {
    const source = readFileSync(file, 'utf8')
    return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  } catch {
    return undefined
  }
}

function isCallbackLike(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
}

function functionNameForNode(node: ts.Node, symbol: string): string | undefined {
  return ts.isFunctionExpression(node) || ts.isArrowFunction(node) ? symbol : undefined
}

function schemaKind(expression: ts.Expression | undefined): 'zod' | 'convex-validator' | 'json-schema' | undefined {
  if (!expression) return undefined
  if (containsReceiver(expression, 'z')) return 'zod'
  if (containsReceiver(expression, 'v')) return 'convex-validator'
  if (ts.isObjectLiteralExpression(expression)) return 'json-schema'
  return undefined
}

function containsReceiver(node: ts.Node, receiverName: string): boolean {
  let found = false
  const visit = (child: ts.Node): void => {
    if (found) return
    if (
      ts.isPropertyAccessExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === receiverName
    ) {
      found = true
      return
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}
