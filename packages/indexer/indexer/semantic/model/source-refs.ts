import ts from 'typescript'
import type { JsonSchema, ProjectDefinition, ProjectSourceRef, ProjectSourceRefRole } from '@crux/core/project-index'
import { collectTopLevelInitializers } from '../../ast/initializers'
import { expressionToJsonSchema } from '../../ast/schemas'
import { sourceForNode, sourceSnippetForNode } from '../../ast/snippets'
import type {
  SemanticDefinitionCandidate,
  SemanticResolvedSource,
  SemanticSchemaCandidate,
  SemanticSourceRefCandidate,
} from '../candidates'
import {
  callExpressionName,
  expressionFromDeclaration,
  functionNameForDeclaration,
  isResolvableSourceExpression,
  isSourceRefDeclaration,
  propertyInitializer,
  symbolNameForDeclaration,
  unwrapExpression,
  variableNameForNode,
} from './source-ref-declarations'

export {
  callExpressionName,
  isResolvableSourceExpression,
  propertyInitializer,
  symbolNameForDeclaration,
  unwrapExpression,
  variableNameForNode,
} from './source-ref-declarations'

/**
 * Resolves source references for `${...}` expressions inside prompt system
 * templates.
 *
 * The returned refs point at original declaration sites for injected fragments
 * and are deduplicated by symbol within the template.
 */
export function semanticTemplateInterpolationSourceRefs(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectSourceRef[] {
  const system = propertyInitializer(candidate.object, 'system')
  if (!system) return []
  const template = unwrapExpression(system)
  if (!ts.isTemplateExpression(template)) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>()
  for (const span of template.templateSpans) {
    const expression = unwrapExpression(span.expression)
    if (!isResolvableSourceExpression(expression)) continue
    const resolved = resolveSemanticExpression(expression, checker, expression.getText())
    if (!resolved || seen.has(resolved.symbol)) continue
    seen.add(resolved.symbol)
    refs.push(
      semanticSourceRef(
        {
          ...candidate,
          property: 'system',
          role: 'system',
          expression,
          metadata: { injected: true, fragment: isFragmentLike(resolved.expression) },
        },
        resolved,
      ),
    )
  }
  return refs
}

/**
 * Resolves source references for a `tools` map, including spread
 * contributors and direct property values.
 *
 * This keeps semantic source evidence tied to the tool map authoring location
 * without mutating the candidate or resolved tool object.
 */
export function semanticToolMapSourceRefs(
  candidate: SemanticDefinitionCandidate,
  checker: ts.TypeChecker,
): ProjectSourceRef[] {
  if (!['prompt', 'context', 'injectable', 'agent'].includes(candidate.kind)) return []
  const tools = propertyInitializer(candidate.object, 'tools')
  if (!tools) return []
  const toolsExpression = unwrapExpression(tools)
  const resolvedTools = isResolvableSourceExpression(toolsExpression)
    ? resolveSemanticExpression(toolsExpression, checker)
    : undefined
  const object = ts.isObjectLiteralExpression(toolsExpression)
    ? toolsExpression
    : resolvedTools?.expression
      ? unwrapExpression(resolvedTools.expression)
      : undefined
  if (!object || !ts.isObjectLiteralExpression(object)) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>()
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      const expression = unwrapExpression(property.expression)
      if (!isResolvableSourceExpression(expression)) continue
      const resolved = resolveSemanticExpression(expression, checker)
      if (!resolved || seen.has(`spread:${resolved.symbol}`)) continue
      seen.add(`spread:${resolved.symbol}`)
      refs.push(
        semanticSourceRef(
          {
            ...candidate,
            property: 'tools',
            role: 'config',
            expression,
            metadata: { toolMapContributor: 'spread' },
          },
          resolved,
        ),
      )
      continue
    }
    const expression = toolMapPropertyExpression(property)
    if (!expression || !isResolvableSourceExpression(expression)) continue
    const resolved = resolveSemanticExpression(expression, checker)
    if (!resolved || seen.has(`property:${resolved.symbol}`)) continue
    seen.add(`property:${resolved.symbol}`)
    refs.push(
      semanticSourceRef(
        {
          ...candidate,
          property: 'tools',
          role: 'config',
          expression,
          metadata: { toolMapContributor: 'property' },
        },
        resolved,
      ),
    )
  }
  return refs
}

/**
 * Finds schema declarations referenced from inside another resolved schema.
 *
 * Nested refs let the index preserve schema composition evidence while avoiding
 * duplicate refs for the root symbol and known schema-library receivers.
 */
export function semanticNestedSchemaSourceRefs(
  candidate: SemanticSchemaCandidate,
  rootResolved: SemanticResolvedSource,
  checker: ts.TypeChecker,
): ProjectSourceRef[] {
  if (!rootResolved.expression) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>([rootResolved.symbol])
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isReferenceIdentifier(node) && !isKnownLibraryIdentifier(node.text)) {
      const resolved = resolveSemanticExpression(node, checker)
      if (resolved?.expression && !seen.has(resolved.symbol) && schemaKind(resolved.expression)) {
        seen.add(resolved.symbol)
        refs.push(
          semanticSchemaSourceRef(candidate, resolved, Boolean(semanticExpressionToJsonSchema(resolved, checker)), {
            nested: true,
          }),
        )
        ts.forEachChild(resolved.expression, visit)
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(rootResolved.expression, visit)
  return refs
}

/**
 * Resolves an identifier or property access expression to its source
 * declaration.
 *
 * The type checker is the only external dependency; inline expressions return
 * undefined because they do not have a reusable declaration to reference.
 */
export function resolveSemanticExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  displaySymbol?: string,
): SemanticResolvedSource | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isIdentifier(unwrapped)) return resolveSemanticSymbol(unwrapped, checker, displaySymbol)
  if (ts.isPropertyAccessExpression(unwrapped))
    return resolveSemanticSymbol(unwrapped.name, checker, displaySymbol ?? unwrapped.getText())
  return undefined
}

/**
 * Resolves a symbol at an AST node, following TypeScript aliases to the source
 * declaration that can be represented as index evidence.
 */
function resolveSemanticSymbol(
  node: ts.Node,
  checker: ts.TypeChecker,
  displaySymbol?: string,
): SemanticResolvedSource | undefined {
  const symbol = shorthandAssignmentValueSymbol(node, checker) ?? checker.getSymbolAtLocation(node)
  const resolvedSymbol =
    symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol
  const declaration = resolvedSymbol?.declarations?.find(isSourceRefDeclaration)
  if (!declaration) return undefined
  const expression = expressionFromDeclaration(declaration)
  return {
    symbol: displaySymbol ?? symbolNameForDeclaration(declaration) ?? resolvedSymbol?.getName() ?? node.getText(),
    sourceFile: declaration.getSourceFile(),
    declaration,
    expression,
    functionName: functionNameForDeclaration(declaration),
  }
}

/**
 * Reads the value symbol for shorthand object assignments.
 */
function shorthandAssignmentValueSymbol(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  if (!ts.isIdentifier(node) || !ts.isShorthandPropertyAssignment(node.parent)) return undefined
  return checker.getShorthandAssignmentValueSymbol(node.parent)
}

/**
 * Builds the base patch for a semantically resolved definition.
 *
 * This pure helper centralizes the resolved/default lifecycle fields used by
 * later enrichment-specific patches.
 */
export function semanticDefinitionPatchBase(candidate: SemanticDefinitionCandidate): ProjectDefinition {
  return {
    id: candidate.definitionId,
    kind: candidate.kind,
    name: candidate.name,
    fidelity: 'resolved',
    status: 'active',
  }
}

/**
 * Creates a source reference for a resolved schema candidate.
 *
 * Metadata records both the detected schema dialect and whether the expression
 * could be converted into Project Index JSON schema.
 */
export function semanticSchemaSourceRef(
  candidate: SemanticSchemaCandidate,
  resolved: SemanticResolvedSource,
  parsedSchema: boolean,
  metadata?: ProjectSourceRef['metadata'],
): ProjectSourceRef {
  return semanticSourceRef(
    {
      ...candidate,
      role: 'schema',
      metadata: {
        schemaKind: schemaKind(resolved.expression),
        parsedSchema,
        ...metadata,
      },
    },
    resolved,
  )
}

/**
 * Attempts to convert a resolved schema expression into Project Index JSON
 * schema.
 *
 * Identifier resolution is delegated recursively through the same type checker,
 * making nested schema conversion deterministic for a fixed TypeScript program.
 */
export function semanticExpressionToJsonSchema(
  resolved: SemanticResolvedSource,
  checker: ts.TypeChecker,
): JsonSchema | undefined {
  if (!resolved.expression) return undefined
  return expressionToJsonSchema(resolved.expression, topLevelInitializers(resolved.sourceFile), {
    resolveIdentifier: (identifier) => {
      const nested = resolveSemanticExpression(identifier, checker)
      if (!nested?.expression || !schemaKind(nested.expression)) return undefined
      return {
        key: semanticResolvedKey(nested),
        expression: nested.expression,
        localInitializers: topLevelInitializers(nested.sourceFile),
      }
    },
  })
}

/**
 * Builds a stable cache key for a resolved source declaration.
 *
 * The key includes file, declaration span, and display symbol so independent
 * declarations with the same name do not collide.
 */
export function semanticResolvedKey(resolved: SemanticResolvedSource): string {
  return `${resolved.sourceFile.fileName}:${resolved.declaration.pos}:${resolved.declaration.end}:${resolved.symbol}`
}

/**
 * Converts a resolved declaration into a Project Index source reference.
 *
 * The candidate supplies the consuming definition/property context while the
 * resolved source supplies declaration location and snippet evidence.
 */
export function semanticSourceRef(
  candidate: SemanticSourceRefCandidate,
  resolved: SemanticResolvedSource,
): ProjectSourceRef {
  const source = sourceForNode(resolved.sourceFile, resolved.declaration)
  return {
    id: `${candidate.definitionId}:source:${candidate.role}:${candidate.property}:${resolved.symbol}`,
    role: candidate.role,
    property: candidate.property,
    symbol: resolved.symbol,
    source: resolved.functionName ? { ...source, function: resolved.functionName } : source,
    snippet: sourceSnippetForNode(resolved.sourceFile, resolved.declaration),
    fidelity: 'resolved',
    ...(candidate.metadata ? { metadata: candidate.metadata } : {}),
  }
}

/**
 * Creates a source reference for routing target expressions.
 *
 * Routing refs are tagged as config evidence so lints and UI affordances can
 * distinguish authored target selection from schema or prompt injection refs.
 */
export function semanticRoutingTargetSourceRef(
  definitionId: string,
  property: string,
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ProjectSourceRef | undefined {
  return semanticResolvedSourceRef(definitionId, property, 'config', expression, checker, { routingTarget: true })
}

/**
 * Resolves a generic expression into a Project Index source reference.
 *
 * Inline/unresolvable expressions return undefined; resolvable identifiers and
 * property accesses produce fresh source-ref values with optional metadata.
 */
export function semanticResolvedSourceRef(
  definitionId: string,
  property: string,
  role: ProjectSourceRefRole,
  expression: ts.Expression,
  checker: ts.TypeChecker,
  metadata?: ProjectSourceRef['metadata'],
): ProjectSourceRef | undefined {
  const unwrapped = unwrapExpression(expression)
  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, checker)
  if (!resolved) return undefined
  const source = sourceForNode(resolved.sourceFile, resolved.declaration)
  return {
    id: `${definitionId}:source:${role}:${property}:${resolved.symbol}`,
    role,
    property,
    symbol: resolved.symbol,
    source: resolved.functionName ? { ...source, function: resolved.functionName } : source,
    snippet: sourceSnippetForNode(resolved.sourceFile, resolved.declaration),
    fidelity: 'resolved',
    ...(metadata ? { metadata } : {}),
  }
}

/**
 * Returns the expression value represented by a tool-map object member.
 */
function toolMapPropertyExpression(property: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isShorthandPropertyAssignment(property)) return property.name
  if (ts.isPropertyAssignment(property)) return property.initializer
  return undefined
}

/**
 * Builds a map of top-level initializer expressions for schema projection.
 */
function topLevelInitializers(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const initializers = new Map<string, ts.Expression>()
  collectTopLevelInitializers(sourceFile, initializers)
  return initializers
}

/**
 * Returns whether a symbol name is a schema-library receiver rather than a
 * user-authored schema reference.
 */
function isKnownLibraryIdentifier(symbol: string): boolean {
  return symbol === 'z' || symbol === 'v'
}

/**
 * Returns whether an identifier occurrence should be treated as a reference
 * rather than a declaration/property key.
 */
function isReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) return false
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false
  if (ts.isParameter(parent) && parent.name === node) return false
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  return true
}

/**
 * Detects prompt fragment-like expressions for interpolation metadata.
 */
function isFragmentLike(expression: ts.Expression | undefined): boolean {
  if (!expression) return false
  const unwrapped = unwrapExpression(expression)
  return (
    ts.isStringLiteralLike(unwrapped) ||
    ts.isTemplateExpression(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  )
}

/**
 * Detects the schema dialect represented by a source expression.
 */
function schemaKind(expression: ts.Expression | undefined): 'zod' | 'convex-validator' | 'json-schema' | undefined {
  if (!expression) return undefined
  if (containsReceiver(expression, 'z')) return 'zod'
  if (containsReceiver(expression, 'v')) return 'convex-validator'
  if (ts.isObjectLiteralExpression(expression)) return 'json-schema'
  return undefined
}

/**
 * Returns whether an AST subtree contains a call/property chain rooted at a
 * specific receiver name.
 */
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
