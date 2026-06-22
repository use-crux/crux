import ts from 'typescript'
import type { JsonSchema, ProjectDefinition, ProjectSourceRef, ProjectSourceRefRole } from '@crux/core/project-index'
import { propertyName } from '../../ast/literals'
import { collectTopLevelInitializers } from '../../ast/initializers'
import { expressionToJsonSchema } from '../../ast/schemas'
import { sourceForNode, sourceSnippetForNode } from '../../ast/snippets'
import type {
  SemanticAnalyzerView,
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
  view: SemanticAnalyzerView,
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
    const resolved = resolveSemanticExpression(expression, view, expression.getText())
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
  view: SemanticAnalyzerView,
): ProjectSourceRef[] {
  if (!['prompt', 'context', 'injectable', 'agent'].includes(candidate.kind)) return []
  const tools = propertyInitializer(candidate.object, 'tools')
  if (!tools) return []
  const toolsExpression = unwrapExpression(tools)
  const resolvedTools = isResolvableSourceExpression(toolsExpression)
    ? resolveSemanticExpression(toolsExpression, view)
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
      const resolved = resolveSemanticExpression(expression, view)
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
    const resolved = resolveSemanticExpression(expression, view)
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
 * Returns the authoring locations that make a `use` entry conditional.
 *
 * The semantic pass uses these refs as provenance for conditional injection
 * facts. A returned ref may point at a `when` predicate, a `match` classifier
 * or branch target, a guarded `&&` expression, or an imported array/config
 * object that participates in one of those shapes.
 *
 * No project code is evaluated here. When TypeScript can resolve an identifier
 * to a declaration, the ref is `resolved`; inline predicates and branch values
 * are still emitted as `partial` refs so callers can navigate to the exact
 * source span without treating the expression as a reusable symbol.
 */
export function semanticInjectionConditionSourceRefs(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectSourceRef[] {
  if (!['prompt', 'context', 'injectable'].includes(candidate.kind)) return []
  const use = propertyInitializer(candidate.object, 'use')
  return use ? injectionConditionSourceRefsFromExpression(candidate.definitionId, use, view, new Set()) : []
}

/**
 * Walks the subset of `use` expressions whose conditional structure can be
 * represented truthfully in the Project Index.
 *
 * The traversal follows arrays and spreads through resolvable declarations,
 * records helper-level policy expressions, and stops at computed/dynamic
 * boundaries. The `seen` set is keyed by source span as well as resolved
 * declarations so recursive arrays or config objects cannot loop forever.
 */
function injectionConditionSourceRefsFromExpression(
  definitionId: string,
  expression: ts.Expression,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): ProjectSourceRef[] {
  const unwrapped = unwrapExpression(expression)
  const key = `${unwrapped.getSourceFile().fileName}:${unwrapped.pos}:${unwrapped.end}`
  if (seen.has(key)) return []
  const nextSeen = new Set(seen)
  nextSeen.add(key)

  if (ts.isCallExpression(unwrapped)) {
    const helperRefs = injectionConditionHelperSourceRefs(definitionId, unwrapped, view, nextSeen)
    if (helperRefs) return helperRefs
  }

  if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return [
      conditionSourceRef(definitionId, 'use', 'policy', unwrapped.left, view, {
        condition: 'binary-guard',
        via: 'binary',
        symbol: injectionConditionSymbol(unwrapped.left, 'binary-guard'),
      }),
      ...injectionConditionSourceRefsFromExpression(definitionId, unwrapped.right, view, nextSeen),
    ]
  }

  const array = semanticConditionArrayExpression(unwrapped, view, nextSeen)
  if (!array) return []
  return array.elements.flatMap((element) => {
    if (ts.isSpreadElement(element)) {
      return [
        conditionSourceRef(definitionId, 'use', 'config', element.expression, view, {
          condition: 'spread-target',
          via: 'spread',
          symbol: injectionConditionSymbol(element.expression, 'spread-target'),
        }),
        ...injectionConditionSourceRefsFromExpression(definitionId, element.expression, view, nextSeen),
      ]
    }
    return ts.isExpression(element)
      ? injectionConditionSourceRefsFromExpression(definitionId, element, view, nextSeen)
      : []
  })
}

/**
 * Interprets Crux conditional helper calls as source-ref evidence.
 *
 * The collector recognizes the public helper shapes that affect injection:
 * `when(predicate, target)` and both `match(config)` / `match(classifier,
 * config)`. It records the condition expression separately from the selected
 * target expressions so downstream UI and lints can explain both "what was
 * injected" and "what controlled that possibility".
 *
 * This function never evaluates predicates or classifiers. Imported config
 * objects are followed through TypeScript declarations only when they resolve
 * to object literals.
 */
function injectionConditionHelperSourceRefs(
  definitionId: string,
  call: ts.CallExpression,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): ProjectSourceRef[] | undefined {
  const callName = callExpressionName(call)
  if (callName === 'when' && call.arguments[1]) {
    const predicate = call.arguments[0]
    const target = call.arguments[1]
    return [
      ...(predicate
        ? [
            conditionSourceRef(definitionId, 'use', 'policy', predicate, view, {
              condition: 'when-predicate',
              via: 'when',
              symbol: injectionConditionSymbol(predicate, 'when-predicate'),
            }),
          ]
        : []),
      conditionSourceRef(definitionId, 'use', 'config', target, view, {
        condition: 'when-target',
        via: 'when',
        symbol: injectionConditionSymbol(target, 'when-target'),
      }),
      ...injectionConditionSourceRefsFromExpression(definitionId, target, view, seen),
    ]
  }

  if (callName === 'match' && call.arguments[0]) {
    const matchShape = semanticMatchConfigExpression(call, view, seen)
    if (!matchShape) return []
    const refs: ProjectSourceRef[] = []
    if (matchShape.classifier) {
      refs.push(
        conditionSourceRef(definitionId, 'use', 'policy', matchShape.classifier, view, {
          condition: 'match-classifier',
          via: 'match',
          symbol: injectionConditionSymbol(matchShape.classifier, 'match-classifier'),
        }),
      )
    }
    refs.push(
      conditionSourceRef(definitionId, 'use', 'config', matchShape.config, view, {
        condition: 'match-config',
        via: 'match',
        symbol: injectionConditionSymbol(matchShape.config, 'match-config'),
      }),
    )
    const matchConfigObject = semanticConditionObjectExpression(matchShape.config, view, seen)
    const cases = matchConfigObject ? conditionObjectProperty(matchConfigObject, 'cases') : undefined
    if (cases) {
      refs.push(
        conditionSourceRef(definitionId, 'use', 'config', cases.expression, view, {
          condition: 'match-cases',
          via: 'match',
          symbol: injectionConditionSymbol(cases.expression, 'match-cases'),
        }),
      )
      const casesObject = semanticConditionObjectExpression(cases.expression, view, seen)
      if (casesObject) {
        for (const property of casesObject.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          const branch = propertyName(property.name)
          refs.push(
            conditionSourceRef(definitionId, 'use', 'config', property.initializer, view, {
              condition: 'match-case',
              via: 'match',
              branch,
              symbol: branch ? `match-case:${branch}` : injectionConditionSymbol(property.initializer, 'match-case'),
            }),
            ...injectionConditionSourceRefsFromExpression(definitionId, property.initializer, view, seen),
          )
        }
      }
    }
    const defaults = matchConfigObject ? conditionObjectProperty(matchConfigObject, 'default') : undefined
    if (defaults) {
      refs.push(
        conditionSourceRef(definitionId, 'use', 'config', defaults.expression, view, {
          condition: 'match-default',
          via: 'match',
          branch: 'default',
          symbol: 'match-default',
        }),
        ...injectionConditionSourceRefsFromExpression(definitionId, defaults.expression, view, seen),
      )
    }
    return refs
  }

  return undefined
}

/**
 * Returns the configuration expression that should be treated as a `match`
 * branch map.
 *
 * Crux currently authors match entries as `match({ cases, default })`, while
 * some call sites may include a classifier argument before the config object.
 * Supporting both shapes here keeps source evidence forward-compatible without
 * broadening runtime behavior or executing the classifier.
 */
function semanticMatchConfigExpression(
  call: ts.CallExpression,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): { classifier?: ts.Expression; config: ts.Expression } | undefined {
  if (call.arguments[1]) {
    const configObject = semanticConditionObjectExpression(call.arguments[1], view, seen)
    return configObject ? { classifier: call.arguments[0], config: call.arguments[1] } : undefined
  }
  const configObject = semanticConditionObjectExpression(call.arguments[0], view, seen)
  return configObject ? { config: call.arguments[0] } : undefined
}

/**
 * Reads a named property from an object literal without losing shorthand
 * authoring provenance.
 *
 * Shorthand properties are normalized to their identifier expression so callers
 * can create source refs for both `{ cases }` and `{ cases: {...} }` without
 * duplicating property-shape logic.
 */
function conditionObjectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): { expression: ts.Expression } | undefined {
  for (const property of object.properties) {
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      propertyName(property.name) === name
    ) {
      return { expression: ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer }
    }
  }
  return undefined
}

/**
 * Resolves an expression to an object literal when doing so is statically safe.
 *
 * Only syntax-local object literals and TypeScript-resolved declaration
 * initializers are followed. The `seen` set prevents cycles across imported
 * constants and deliberately stops before computed values that would require
 * user-code execution.
 */
function semanticConditionObjectExpression(
  expression: ts.Expression,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isObjectLiteralExpression(unwrapped)) return unwrapped
  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, view)
  if (!resolved?.expression) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  return semanticConditionObjectExpression(resolved.expression, view, nextSeen)
}

/**
 * Resolves an expression to an array literal when it can be inspected without
 * executing user code.
 *
 * This mirrors semantic use-entry enrichment: local arrays, imported arrays,
 * and spreads are transparent when TypeScript can prove their initializer; all
 * computed arrays remain opaque and produce no invented source refs.
 */
function semanticConditionArrayExpression(
  expression: ts.Expression,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): ts.ArrayLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isArrayLiteralExpression(unwrapped)) return unwrapped
  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, view)
  if (!resolved?.expression) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  return semanticConditionArrayExpression(resolved.expression, view, nextSeen)
}

/**
 * Converts a condition expression into a Project Index source ref with enough
 * metadata for lints and UI to explain why a field is conditional.
 *
 * Resolvable identifiers/property accesses point at their declaration with
 * `fidelity: "resolved"`. Inline expressions still produce a useful snippet
 * and location with `fidelity: "partial"`, which lets callers explain the
 * condition without overstating that it has a reusable symbol.
 */
function conditionSourceRef(
  definitionId: string,
  property: string,
  role: ProjectSourceRefRole,
  expression: ts.Expression,
  view: SemanticAnalyzerView,
  options: {
    condition: string
    via: string
    branch?: string
    symbol: string
  },
): ProjectSourceRef {
  const unwrapped = unwrapExpression(expression)
  const metadata: ProjectSourceRef['metadata'] = {
    extensions: {
      injectionCondition: options.condition,
      via: options.via,
      ...(options.branch ? { branch: options.branch } : {}),
    },
  }
  const resolved = isResolvableSourceExpression(unwrapped) ? resolveSemanticExpression(unwrapped, view) : undefined
  if (resolved) {
    const source = sourceForNode(resolved.sourceFile, resolved.declaration)
    return {
      id: `${definitionId}:source:${role}:${property}:${sourceRefIdSegment(options.condition)}:${sourceRefIdSegment(
        options.branch ?? '',
      )}:${sourceRefIdSegment(resolved.symbol)}`,
      role,
      property,
      symbol: resolved.symbol,
      source: resolved.functionName ? { ...source, function: resolved.functionName } : source,
      snippet: sourceSnippetForNode(resolved.sourceFile, resolved.declaration),
      fidelity: 'resolved',
      metadata,
    }
  }
  const sourceFile = unwrapped.getSourceFile()
  return {
    id: `${definitionId}:source:${role}:${property}:${sourceRefIdSegment(options.condition)}:${sourceRefIdSegment(
      options.branch ?? '',
    )}:${unwrapped.pos}:${unwrapped.end}`,
    role,
    property,
    symbol: options.symbol,
    source: sourceForNode(sourceFile, unwrapped),
    snippet: sourceSnippetForNode(sourceFile, unwrapped),
    fidelity: 'partial',
    metadata,
  }
}

/**
 * Chooses a stable label for inline condition refs that have no declaration
 * symbol.
 *
 * Resolved refs replace this with the declaration symbol; this fallback is only
 * used for inline lambdas, branch arrays, and other expressions that have a
 * source location but no declaration node.
 */
function injectionConditionSymbol(expression: ts.Expression, fallback: string): string {
  const unwrapped = unwrapExpression(expression)
  if (ts.isIdentifier(unwrapped)) return unwrapped.text
  if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name.text
  if (ts.isCallExpression(unwrapped)) return callExpressionName(unwrapped) ?? fallback
  return fallback
}

/**
 * Encodes a readable value for use inside deterministic source-ref ids.
 *
 * Source-ref ids are persisted in snapshots and used as UI keys, so the segment
 * must be stable across platforms while still being recognizable in debugging
 * output.
 */
function sourceRefIdSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]+/g, '_') || 'inline'
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
  view: SemanticAnalyzerView,
): ProjectSourceRef[] {
  if (!rootResolved.expression) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>([rootResolved.symbol])
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isReferenceIdentifier(node) && !isKnownLibraryIdentifier(node.text)) {
      const resolved = resolveSemanticExpression(node, view)
      if (resolved?.expression && !seen.has(resolved.symbol) && schemaKind(resolved.expression)) {
        seen.add(resolved.symbol)
        refs.push(
          semanticSchemaSourceRef(candidate, resolved, Boolean(semanticExpressionToJsonSchema(resolved, view)), {
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
 * The compiler view is the only external dependency; inline expressions return
 * undefined because they do not have a reusable declaration to reference.
 */
export function resolveSemanticExpression(
  expression: ts.Expression,
  view: SemanticAnalyzerView,
  displaySymbol?: string,
): SemanticResolvedSource | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isIdentifier(unwrapped)) return resolveSemanticSymbol(unwrapped, view, displaySymbol)
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const resolved = resolveSemanticSymbol(unwrapped.name, view, displaySymbol ?? unwrapped.getText())
    return resolved && isUsablePropertyAccessResolution(unwrapped, resolved) ? resolved : undefined
  }
  return undefined
}

function isUsablePropertyAccessResolution(
  expression: ts.PropertyAccessExpression,
  resolved: SemanticResolvedSource,
): boolean {
  if (isNamespaceImportPropertyAccess(expression)) return true
  return !(
    ts.isFunctionDeclaration(resolved.declaration) &&
    resolved.declaration.name?.text === expression.name.text &&
    resolved.sourceFile.fileName !== expression.getSourceFile().fileName
  )
}

function isNamespaceImportPropertyAccess(expression: ts.PropertyAccessExpression): boolean {
  if (!ts.isIdentifier(expression.expression)) return false
  const namespace = expression.expression.text
  return expression
    .getSourceFile()
    .statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        statement.importClause?.namedBindings &&
        ts.isNamespaceImport(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.name.text === namespace,
    )
}

/**
 * Resolves a symbol at an AST node, following TypeScript aliases to the source
 * declaration that can be represented as index evidence.
 */
function resolveSemanticSymbol(
  node: ts.Node,
  view: SemanticAnalyzerView,
  displaySymbol?: string,
): SemanticResolvedSource | undefined {
  const resolvedSymbol = view.resolvedSymbols([node])[0]
  const declaration = resolvedSymbol
    ? view.declarationsOf([resolvedSymbol])[0]?.find(isSourceRefDeclaration)
    : undefined
  if (!declaration) return undefined
  const expression = expressionFromDeclaration(declaration)
  return {
    symbol: displaySymbol ?? symbolNameForDeclaration(declaration) ?? resolvedSymbol?.name ?? node.getText(),
    sourceFile: declaration.getSourceFile(),
    declaration,
    expression,
    functionName: functionNameForDeclaration(declaration),
  }
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
 * Identifier resolution is delegated recursively through the same type view,
 * making nested schema conversion deterministic for a fixed TypeScript program.
 */
export function semanticExpressionToJsonSchema(
  resolved: SemanticResolvedSource,
  view: SemanticAnalyzerView,
): JsonSchema | undefined {
  if (!resolved.expression) return undefined
  return expressionToJsonSchema(resolved.expression, topLevelInitializers(resolved.sourceFile), {
    resolveIdentifier: (identifier) => {
      const nested = resolveSemanticExpression(identifier, view)
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
  view: SemanticAnalyzerView,
): ProjectSourceRef | undefined {
  return semanticResolvedSourceRef(definitionId, property, 'config', expression, view, { routingTarget: true })
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
  view: SemanticAnalyzerView,
  metadata?: ProjectSourceRef['metadata'],
): ProjectSourceRef | undefined {
  const unwrapped = unwrapExpression(expression)
  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, view)
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
