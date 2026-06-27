import type { JsonSchema, ProjectDefinition, ProjectSourceRef, ProjectSourceRefRole } from '@use-crux/core/project-index'
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
  SemanticResolvedSource,
  SemanticSchemaCandidate,
  SemanticSourceRefCandidate,
} from '../candidates'
import {
  semanticNodeKey,
  semanticNodeName,
  semanticSourceForNode,
  semanticSourceSnippetForNode,
} from '../syntax-readers'
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
import { semanticExpressionToJsonSchemaNode, semanticTopLevelInitializers } from './schema-json'

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
  const system = propertyInitializer(candidate.object, 'system', view)
  if (!system) return []
  const template = unwrapExpression(system, view)
  const expressions = view.syntax.templateExpressions(template)
  if (expressions.length === 0) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>()
  for (const spanExpression of expressions) {
    const expression = unwrapExpression(spanExpression, view)
    if (!isResolvableSourceExpression(expression, view)) continue
    const resolved = resolveSemanticExpression(expression, view, view.syntax.text(expression))
    if (!resolved || seen.has(resolved.symbol)) continue
    seen.add(resolved.symbol)
    refs.push(
      semanticSourceRef(
        {
          ...candidate,
          property: 'system',
          role: 'system',
          expression,
          metadata: { injected: true, fragment: isFragmentLike(resolved.expression, view) },
        },
        resolved,
        view,
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
  const tools = propertyInitializer(candidate.object, 'tools', view)
  if (!tools) return []
  const toolsExpression = unwrapExpression(tools, view)
  const resolvedTools = isResolvableSourceExpression(toolsExpression, view)
    ? resolveSemanticExpression(toolsExpression, view)
    : undefined
  const object = view.syntax.isKind(toolsExpression, 'objectLiteral')
    ? toolsExpression
    : resolvedTools?.expression
      ? unwrapExpression(resolvedTools.expression, view)
      : undefined
  if (!object || !view.syntax.isKind(object, 'objectLiteral')) return []
  const refs: ProjectSourceRef[] = []
  const seen = new Set<string>()
  for (const property of view.syntax.objectProperties(object)) {
    const spread = view.syntax.spreadExpression(property)
    if (spread) {
      const expression = unwrapExpression(spread, view)
      if (!isResolvableSourceExpression(expression, view)) continue
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
          view,
        ),
      )
      continue
    }
    const expression = toolMapPropertyExpression(property, view)
    if (!expression || !isResolvableSourceExpression(expression, view)) continue
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
        view,
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
  const use = propertyInitializer(candidate.object, 'use', view)
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
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): ProjectSourceRef[] {
  const unwrapped = unwrapExpression(expression, view)
  const key = semanticNodeKey(unwrapped, view.syntax)
  if (seen.has(key)) return []
  const nextSeen = new Set(seen)
  nextSeen.add(key)

  if (view.syntax.isKind(unwrapped, 'callExpression')) {
    const helperRefs = injectionConditionHelperSourceRefs(definitionId, unwrapped, view, nextSeen)
    if (helperRefs) return helperRefs
  }

  const logicalAnd = view.syntax.logicalAndOperands(unwrapped)
  if (logicalAnd) {
    return [
      conditionSourceRef(definitionId, 'use', 'policy', logicalAnd.left, view, {
        condition: 'binary-guard',
        via: 'binary',
        symbol: injectionConditionSymbol(logicalAnd.left, 'binary-guard', view),
      }),
      ...injectionConditionSourceRefsFromExpression(definitionId, logicalAnd.right, view, nextSeen),
    ]
  }

  const array = semanticConditionArrayExpression(unwrapped, view, nextSeen)
  if (!array) return []
  return view.syntax.arrayElements(array).flatMap((element) => {
    const spread = view.syntax.spreadExpression(element)
    if (spread) {
      return [
        conditionSourceRef(definitionId, 'use', 'config', spread, view, {
          condition: 'spread-target',
          via: 'spread',
          symbol: injectionConditionSymbol(spread, 'spread-target', view),
        }),
        ...injectionConditionSourceRefsFromExpression(definitionId, spread, view, nextSeen),
      ]
    }
    return injectionConditionSourceRefsFromExpression(definitionId, element, view, nextSeen)
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
  call: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): ProjectSourceRef[] | undefined {
  const callName = callExpressionName(call, view)
  const args = view.syntax.callArguments(call)
  if (callName === 'when' && args[1]) {
    const predicate = args[0]
    const target = args[1]
    return [
      ...(predicate
        ? [
            conditionSourceRef(definitionId, 'use', 'policy', predicate, view, {
              condition: 'when-predicate',
              via: 'when',
              symbol: injectionConditionSymbol(predicate, 'when-predicate', view),
            }),
          ]
        : []),
      conditionSourceRef(definitionId, 'use', 'config', target, view, {
        condition: 'when-target',
        via: 'when',
        symbol: injectionConditionSymbol(target, 'when-target', view),
      }),
      ...injectionConditionSourceRefsFromExpression(definitionId, target, view, seen),
    ]
  }

  if (callName === 'match' && args[0]) {
    const matchShape = semanticMatchConfigExpression(call, view, seen)
    if (!matchShape) return []
    const refs: ProjectSourceRef[] = []
    if (matchShape.classifier) {
      refs.push(
        conditionSourceRef(definitionId, 'use', 'policy', matchShape.classifier, view, {
          condition: 'match-classifier',
          via: 'match',
          symbol: injectionConditionSymbol(matchShape.classifier, 'match-classifier', view),
        }),
      )
    }
    refs.push(
      conditionSourceRef(definitionId, 'use', 'config', matchShape.config, view, {
        condition: 'match-config',
        via: 'match',
        symbol: injectionConditionSymbol(matchShape.config, 'match-config', view),
      }),
    )
    const matchConfigObject = semanticConditionObjectExpression(matchShape.config, view, seen)
    const cases = matchConfigObject ? conditionObjectProperty(matchConfigObject, 'cases', view) : undefined
    if (cases) {
      refs.push(
        conditionSourceRef(definitionId, 'use', 'config', cases.expression, view, {
          condition: 'match-cases',
          via: 'match',
          symbol: injectionConditionSymbol(cases.expression, 'match-cases', view),
        }),
      )
      const casesObject = semanticConditionObjectExpression(cases.expression, view, seen)
      if (casesObject) {
        for (const property of view.syntax.objectProperties(casesObject)) {
          const branch = view.syntax.propertyName(property)
            ? semanticNodeName(view.syntax.propertyName(property)!, view.syntax)
            : undefined
          const expression = view.syntax.propertyInitializer(property)
          if (!expression) continue
          refs.push(
            conditionSourceRef(definitionId, 'use', 'config', expression, view, {
              condition: 'match-case',
              via: 'match',
              branch,
              symbol: branch ? `match-case:${branch}` : injectionConditionSymbol(expression, 'match-case', view),
            }),
            ...injectionConditionSourceRefsFromExpression(definitionId, expression, view, seen),
          )
        }
      }
    }
    const defaults = matchConfigObject ? conditionObjectProperty(matchConfigObject, 'default', view) : undefined
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
  call: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): {
  classifier?: SemanticAnalyzerNode<SemanticAnalyzerView>
  config: SemanticAnalyzerNode<SemanticAnalyzerView>
} | undefined {
  const args = view.syntax.callArguments(call)
  if (args[1]) {
    const configObject = semanticConditionObjectExpression(args[1], view, seen)
    return configObject ? { classifier: args[0], config: args[1] } : undefined
  }
  const configObject = args[0] ? semanticConditionObjectExpression(args[0], view, seen) : undefined
  return configObject && args[0] ? { config: args[0] } : undefined
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
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): { expression: SemanticAnalyzerNode<SemanticAnalyzerView> } | undefined {
  for (const property of view.syntax.objectProperties(object)) {
    const propertyNameNode = view.syntax.propertyName(property)
    if (propertyNameNode && semanticNodeName(propertyNameNode, view.syntax) === name) {
      const expression = view.syntax.propertyInitializer(property)
      return expression ? { expression } : undefined
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
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const unwrapped = unwrapExpression(expression, view)
  if (view.syntax.isKind(unwrapped, 'objectLiteral')) return unwrapped
  if (!isResolvableSourceExpression(unwrapped, view)) return undefined
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
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const unwrapped = unwrapExpression(expression, view)
  if (view.syntax.isKind(unwrapped, 'arrayLiteral')) return unwrapped
  if (!isResolvableSourceExpression(unwrapped, view)) return undefined
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
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  options: {
    condition: string
    via: string
    branch?: string
    symbol: string
  },
): ProjectSourceRef {
  const unwrapped = unwrapExpression(expression, view)
  const metadata: ProjectSourceRef['metadata'] = {
    extensions: {
      injectionCondition: options.condition,
      via: options.via,
      ...(options.branch ? { branch: options.branch } : {}),
    },
  }
  const resolved = isResolvableSourceExpression(unwrapped, view) ? resolveSemanticExpression(unwrapped, view) : undefined
  if (resolved) {
    const source = semanticSourceForNode(resolved.declaration, view.syntax)
    return {
      id: `${definitionId}:source:${role}:${property}:${sourceRefIdSegment(options.condition)}:${sourceRefIdSegment(
        options.branch ?? '',
      )}:${sourceRefIdSegment(resolved.symbol)}`,
      role,
      property,
      symbol: resolved.symbol,
      source: resolved.functionName ? { ...source, function: resolved.functionName } : source,
      snippet: semanticSourceSnippetForNode(resolved.declaration, view.syntax),
      fidelity: 'resolved',
      metadata,
    }
  }
  return {
    id: `${definitionId}:source:${role}:${property}:${sourceRefIdSegment(options.condition)}:${sourceRefIdSegment(
      options.branch ?? '',
    )}:${unwrapped.pos}:${unwrapped.end}`,
    role,
    property,
    symbol: options.symbol,
    source: semanticSourceForNode(unwrapped, view.syntax),
    snippet: semanticSourceSnippetForNode(unwrapped, view.syntax),
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
function injectionConditionSymbol(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  fallback: string,
  view: SemanticAnalyzerView,
): string {
  const unwrapped = unwrapExpression(expression, view)
  if (view.syntax.isKind(unwrapped, 'identifier')) return view.syntax.identifierText(unwrapped) ?? fallback
  if (view.syntax.isKind(unwrapped, 'propertyAccessExpression')) return view.syntax.propertyAccessName(unwrapped) ?? fallback
  if (view.syntax.isKind(unwrapped, 'callExpression')) return callExpressionName(unwrapped, view) ?? fallback
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
  const visit = (node: SemanticAnalyzerNode<SemanticAnalyzerView>): void => {
    const name = view.syntax.identifierText(node)
    if (name && isReferenceIdentifier(node, view) && !isKnownLibraryIdentifier(name)) {
      const resolved = resolveSemanticExpression(node, view)
      if (resolved?.expression && !seen.has(resolved.symbol) && schemaKind(resolved.expression, view)) {
        seen.add(resolved.symbol)
        refs.push(
          semanticSchemaSourceRef(candidate, resolved, Boolean(semanticExpressionToJsonSchema(resolved, view)), view, {
            nested: true,
          }),
        )
        view.syntax.children(resolved.expression).forEach(visit)
        return
      }
    }
    view.syntax.children(node).forEach(visit)
  }
  view.syntax.children(rootResolved.expression).forEach(visit)
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
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  displaySymbol?: string,
): SemanticResolvedSource | undefined {
  const unwrapped = unwrapExpression(expression, view)
  if (view.syntax.isKind(unwrapped, 'identifier')) return resolveSemanticSymbol(unwrapped, view, displaySymbol)
  if (view.syntax.isKind(unwrapped, 'propertyAccessExpression')) {
    const name = view.syntax.propertyAccessNameNode(unwrapped)
    if (!name) return undefined
    const resolved = resolveSemanticSymbol(name, view, displaySymbol ?? view.syntax.text(unwrapped))
    return resolved && isUsablePropertyAccessResolution(unwrapped, resolved, view) ? resolved : undefined
  }
  return undefined
}

function isUsablePropertyAccessResolution(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  resolved: SemanticResolvedSource,
  view: SemanticAnalyzerView,
): boolean {
  if (isNamespaceImportPropertyAccess(expression, view)) return true
  const propertyName = view.syntax.propertyAccessName(expression)
  const declarationName = symbolNameForDeclaration(resolved.declaration, view)
  return !(
    view.syntax.kind(resolved.declaration) === 'functionDeclaration' &&
    declarationName === propertyName &&
    resolved.sourceFile.fileName !== view.syntax.sourceFile(expression).fileName
  )
}

function isNamespaceImportPropertyAccess(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): boolean {
  const receiver = view.syntax.propertyAccessExpression(expression)
  const namespace = receiver ? view.syntax.identifierText(receiver) : undefined
  if (!namespace) return false
  return view.syntax
    .children(view.syntax.sourceFile(expression))
    .some((statement) => view.syntax.namespaceImportName(statement) === namespace)
}

/**
 * Resolves a symbol at an AST node, following TypeScript aliases to the source
 * declaration that can be represented as index evidence.
 */
function resolveSemanticSymbol(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  displaySymbol?: string,
): SemanticResolvedSource | undefined {
  const resolvedSymbol = view.resolvedSymbols([node])[0]
  const declaration = resolvedSymbol
    ? view.declarationsOf([resolvedSymbol])[0]?.find((item) => isSourceRefDeclaration(item, view))
    : undefined
  if (!declaration) return undefined
  const expression = expressionFromDeclaration(declaration, view)
  return {
    symbol: displaySymbol ?? symbolNameForDeclaration(declaration, view) ?? resolvedSymbol?.name ?? view.syntax.text(node),
    sourceFile: view.sourceFile(declaration),
    declaration,
    expression,
    functionName: functionNameForDeclaration(declaration, view),
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
  view: SemanticAnalyzerView,
  metadata?: ProjectSourceRef['metadata'],
): ProjectSourceRef {
  return semanticSourceRef(
    {
      ...candidate,
      role: 'schema',
      metadata: {
        schemaKind: schemaKind(resolved.expression, view),
        parsedSchema,
        ...metadata,
      },
    },
    resolved,
    view,
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
  return semanticExpressionToJsonSchemaNode(resolved.expression, semanticTopLevelInitializers(resolved.sourceFile, view), view, {
    resolveIdentifier: (identifier) => {
      const nested = resolveSemanticExpression(identifier, view)
      if (!nested?.expression || !schemaKind(nested.expression, view)) return undefined
      return {
        key: semanticResolvedKey(nested),
        expression: nested.expression,
        localInitializers: semanticTopLevelInitializers(nested.sourceFile, view),
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
  view: SemanticAnalyzerView,
): ProjectSourceRef {
  const source = semanticSourceForNode(resolved.declaration, view.syntax)
  return {
    id: `${candidate.definitionId}:source:${candidate.role}:${candidate.property}:${resolved.symbol}`,
    role: candidate.role,
    property: candidate.property,
    symbol: resolved.symbol,
    source: resolved.functionName ? { ...source, function: resolved.functionName } : source,
    snippet: semanticSourceSnippetForNode(resolved.declaration, view.syntax),
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
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
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
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  metadata?: ProjectSourceRef['metadata'],
): ProjectSourceRef | undefined {
  const unwrapped = unwrapExpression(expression, view)
  if (!isResolvableSourceExpression(unwrapped, view)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, view)
  if (!resolved) return undefined
  const source = semanticSourceForNode(resolved.declaration, view.syntax)
  return {
    id: `${definitionId}:source:${role}:${property}:${resolved.symbol}`,
    role,
    property,
    symbol: resolved.symbol,
    source: resolved.functionName ? { ...source, function: resolved.functionName } : source,
    snippet: semanticSourceSnippetForNode(resolved.declaration, view.syntax),
    fidelity: 'resolved',
    ...(metadata ? { metadata } : {}),
  }
}

/**
 * Returns the expression value represented by a tool-map object member.
 */
function toolMapPropertyExpression(
  property: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  return view.syntax.propertyInitializer(property)
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
function isReferenceIdentifier(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): boolean {
  const parent = view.syntax.parent(node)
  if (!parent) return true
  if (view.syntax.propertyName(parent) === node) return false
  if (view.syntax.variableDeclarationName(parent) === node) return false
  if (view.syntax.declarationName(parent) === node) return false
  if (view.syntax.propertyAccessNameNode(parent) === node) return false
  return true
}

/**
 * Detects prompt fragment-like expressions for interpolation metadata.
 */
function isFragmentLike(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView> | undefined,
  view: SemanticAnalyzerView,
): boolean {
  if (!expression) return false
  const unwrapped = unwrapExpression(expression, view)
  return view.syntax.stringLiteralText(unwrapped) !== undefined || view.syntax.templateExpressions(unwrapped).length > 0
}

/**
 * Detects the schema dialect represented by a source expression.
 */
function schemaKind(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView> | undefined,
  view: SemanticAnalyzerView,
): 'zod' | 'convex-validator' | 'json-schema' | undefined {
  if (!expression) return undefined
  if (containsReceiver(expression, 'z', view)) return 'zod'
  if (containsReceiver(expression, 'v', view)) return 'convex-validator'
  if (view.syntax.isKind(expression, 'objectLiteral')) return 'json-schema'
  return undefined
}

/**
 * Returns whether an AST subtree contains a call/property chain rooted at a
 * specific receiver name.
 */
function containsReceiver(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  receiverName: string,
  view: SemanticAnalyzerView,
): boolean {
  let found = false
  const visit = (child: SemanticAnalyzerNode<SemanticAnalyzerView>): void => {
    if (found) return
    const receiver = view.syntax.propertyAccessExpression(child)
    if (receiver && view.syntax.identifierText(receiver) === receiverName) {
      found = true
      return
    }
    view.syntax.children(child).forEach(visit)
  }
  visit(node)
  return found
}
