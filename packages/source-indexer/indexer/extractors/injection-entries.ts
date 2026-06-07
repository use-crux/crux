import ts from 'typescript'
import type { InjectionToolFacts, InjectionUseFacts } from '@crux/core/catalog'
import type { StaticRelationRef } from '../types'
import type { ExtractContext } from '../extensions'
import { propertyName } from '../ast/literals'
import { resolveIdentifierSourceNode } from '../ast/source-refs'
import { internalStaticCallContext } from '../extensions/internal-native'

type InjectionOwner = 'prompt' | 'context' | 'injectable'

/** Injection dependency fact enriched with the source-local variable used for relation binding. */
interface UseEntryWithSource extends InjectionUseFacts {
  readonly variable?: string
}

/** Tool contribution facts plus source-local variables that should become unresolved tool relations. */
interface ToolExtraction {
  readonly facts?: InjectionToolFacts
  readonly references: readonly string[]
}

/** Value summary of statically visible contributions returned by an injectable callback. */
export interface InjectableStaticContributions {
  readonly useEntries: readonly UseEntryWithSource[]
  readonly tools: ToolExtraction
  readonly mayInject: readonly string[]
}

/**
 * Reads an injection-like config property and returns the statically visible dependency entries it contains.
 *
 * The helper understands direct identifiers, local array constants, `when(...)`, and `match(...)` branches. It
 * intentionally returns conservative "unknown" or "dynamic" entries for shapes that require evaluation so callers
 * can preserve authored dependency intent without executing user code.
 */
export function injectionUseEntriesForConfigProperty(
  ctx: ExtractContext,
  property: string,
): readonly UseEntryWithSource[] {
  const expression = propertyExpression(ctx, property)
  return expression ? injectionUseEntriesFromExpression(ctx, expression) : []
}

/**
 * Extracts injection dependency entries from a known object literal property.
 *
 * This is used by callback-return parsers such as `inject: () => ({ contexts: [...] })`, where the relevant
 * dependency array is nested below a returned object rather than on the primitive's top-level config.
 */
export function injectionUseEntriesFromObjectProperty(
  ctx: ExtractContext,
  object: ts.ObjectLiteralExpression,
  property: string,
): readonly UseEntryWithSource[] {
  const expression = propertyExpressionFromObject(object, property)
  return expression ? injectionUseEntriesFromExpression(ctx, expression) : []
}

/**
 * Converts extracted injection entries into unresolved catalog relation refs.
 *
 * Relation refs stay source-local at this point: they keep the authored variable name plus a target-kind map, and
 * the relation resolver later decides whether the target is a context, injectable, memory, or blackboard definition.
 */
export function relationRefsForInjectionUse(
  owner: InjectionOwner,
  fromId: string,
  entries: readonly UseEntryWithSource[],
): readonly StaticRelationRef[] {
  return entries.flatMap((entry) => {
    if (!entry.variable) return []
    const type = relationTypeForHint(owner, entry.relationHint)
    return [
      {
        type,
        typeByTargetKind: relationTypesByTargetKind(owner),
        fromId,
        toVariable: entry.variable,
      },
    ]
  })
}

/**
 * Reads a top-level tools-like config property and returns both catalog facts and unresolved tool references.
 *
 * Object literals preserve user-facing tool names while shorthand and identifier initializers preserve relation
 * targets. Dynamic shapes still mark the primitive as tool-capable without inventing dependencies.
 */
export function toolContributionsForConfigProperty(ctx: ExtractContext, property: string): ToolExtraction {
  const expression = propertyExpression(ctx, property)
  return toolContributionsFromExpression(expression, ctx)
}

/**
 * Reads a tools-like property from an already discovered object literal.
 *
 * This supports callback-return objects such as injectable `tools` contributions and keeps that parsing behavior
 * shared with top-level config parsing.
 */
export function toolContributionsFromObjectProperty(
  object: ts.ObjectLiteralExpression,
  property: string,
): ToolExtraction {
  return toolContributionsFromExpression(propertyExpressionFromObject(object, property))
}

/**
 * Projects an injectable callback return object into catalog-facing contribution values.
 *
 * The extractor does not need to hold a TypeScript object literal to understand what an injectable may
 * contribute. This helper keeps callback-return traversal inside the compiler-owned parsing layer and
 * exposes only injection entries, tool refs, and a list of visible contribution properties.
 */
export function injectableStaticContributions(
  ctx: ExtractContext,
  properties: readonly string[],
): InjectableStaticContributions {
  const returnObject = injectableReturnObject(ctx)
  if (!returnObject) {
    return { useEntries: [], tools: { references: [] }, mayInject: [] }
  }
  return {
    useEntries: injectionUseEntriesFromObjectProperty(ctx, returnObject, 'contexts'),
    tools: toolContributionsFromObjectProperty(returnObject, 'tools'),
    mayInject: properties.filter((property) => hasObjectProperty(returnObject, property)),
  }
}

/**
 * Returns the object literal produced by an injectable callback when it is statically visible.
 *
 * Supported forms include inline object returns, parenthesized object returns, and simple block-bodied returns.
 * The function never evaluates the callback; it only unwraps syntax that TypeScript already parsed.
 */
export function injectableReturnObject(
  ctx: ExtractContext,
  property = 'inject',
): ts.ObjectLiteralExpression | undefined {
  const expression = propertyExpression(ctx, property)
  if (!expression) return undefined
  return returnedObjectLiteral(resolveLocalExpression(ctx, expression))
}

/**
 * Converts supported injection expressions into dependency entries without evaluating user code.
 *
 * Recursive calls preserve branch/conditional metadata as the parser walks array literals, local array constants,
 * conditional helpers, and binary guards. Unsupported calls become dynamic entries so indexer output remains honest.
 */
function injectionUseEntriesFromExpression(
  ctx: ExtractContext,
  expression: ts.Expression,
  inherited: Partial<Pick<UseEntryWithSource, 'conditionality' | 'via' | 'branch'>> = {},
  seen: ReadonlySet<string> = new Set(),
): readonly UseEntryWithSource[] {
  const resolved = expression

  if (ts.isArrayLiteralExpression(resolved)) {
    return resolved.elements.flatMap((element) => {
      if (ts.isSpreadElement(element)) {
        return injectionUseEntriesFromExpression(
          ctx,
          element.expression,
          { conditionality: inherited.conditionality ?? 'unknown', via: 'spread', branch: inherited.branch },
          seen,
        )
      }
      return injectionUseEntriesFromExpression(ctx, element as ts.Expression, inherited, seen)
    })
  }

  if (ts.isIdentifier(resolved)) {
    const local = localInitializers(ctx).get(resolved.text)
    if (local && !seen.has(resolved.text) && ts.isArrayLiteralExpression(local)) {
      return injectionUseEntriesFromExpression(
        ctx,
        local,
        {
          conditionality: inherited.conditionality ?? 'always',
          via: inherited.via ?? 'array-ref',
          branch: inherited.branch,
        },
        new Set([...seen, resolved.text]),
      )
    }
    return [
      {
        variable: resolved.text,
        relationHint: 'unknown',
        conditionality: inherited.conditionality ?? 'always',
        via: inherited.via ?? 'direct',
        ...(inherited.branch ? { branch: inherited.branch } : {}),
      },
    ]
  }

  if (ts.isCallExpression(resolved)) {
    const callName = expressionName(resolved.expression)
    if (callName === 'when' && resolved.arguments[1]) {
      return injectionUseEntriesFromExpression(ctx, resolved.arguments[1], {
        conditionality: 'when',
        via: 'when',
        branch: inherited.branch,
      })
    }
    if (callName === 'match' && resolved.arguments[0] && ts.isObjectLiteralExpression(resolved.arguments[0])) {
      return matchUseEntries(ctx, resolved.arguments[0])
    }
    return [{ conditionality: 'dynamic', via: inherited.via ?? 'direct' }]
  }

  if (ts.isBinaryExpression(resolved) && resolved.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return injectionUseEntriesFromExpression(ctx, resolved.right, {
      conditionality: 'binary-guard',
      via: 'binary',
      branch: inherited.branch,
    })
  }

  return [{ conditionality: 'unknown', via: inherited.via ?? 'direct' }]
}

/**
 * Extracts branch-aware dependency entries from the Crux `match(...)` helper shape.
 *
 * Each object key in `cases` becomes the `branch` metadata for the extracted entry; the optional `default` property
 * is represented as a dedicated default branch.
 */
function matchUseEntries(ctx: ExtractContext, object: ts.ObjectLiteralExpression): readonly UseEntryWithSource[] {
  const cases = propertyExpressionFromObject(object, 'cases')
  const defaults = propertyExpressionFromObject(object, 'default')
  const caseEntries =
    cases && ts.isObjectLiteralExpression(cases)
      ? cases.properties.flatMap((item): readonly UseEntryWithSource[] => {
          if (!ts.isPropertyAssignment(item)) return []
          const branch = propertyName(item.name)
          return injectionUseEntriesFromExpression(ctx, item.initializer, {
            conditionality: 'match-case',
            via: 'match',
            ...(branch ? { branch } : {}),
          })
        })
      : []
  const defaultEntries = defaults
    ? injectionUseEntriesFromExpression(ctx, defaults, {
        conditionality: 'match-default',
        via: 'match',
        branch: 'default',
      })
    : []
  return [...caseEntries, ...defaultEntries]
}

/**
 * Projects a tools expression into catalog-facing facts and relation targets.
 *
 * Object literals are treated as statically visible tool maps. Other expressions are marked dynamic because the
 * compiler can see that tools may be provided but cannot safely name them.
 */
function toolContributionsFromExpression(
  expression: ts.Expression | undefined,
  ctx?: ExtractContext,
  seen: ReadonlySet<string> = new Set(),
): ToolExtraction {
  if (!expression) return { references: [] }
  if (ts.isObjectLiteralExpression(expression)) {
    return toolContributionsFromObjectLiteral(expression)
  }
  if (ctx && ts.isCallExpression(expression)) {
    return toolContributionsFromFactoryCall(ctx, expression, seen)
  }
  return { facts: { hasTools: true, dynamic: true }, references: [] }
}

/** Extracts visible tool names from an object-literal tool map. */
function toolContributionsFromObjectLiteral(object: ts.ObjectLiteralExpression): ToolExtraction {
  const dynamic = object.properties.some(
    (item) =>
      ts.isSpreadAssignment(item) ||
      ((ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && ts.isComputedPropertyName(item.name)),
  )
  const contributions = object.properties.flatMap(
      (item): readonly { readonly name?: string; readonly reference?: string }[] => {
        if (ts.isShorthandPropertyAssignment(item)) {
          return [{ name: item.name.text, reference: item.name.text }]
        }
        if (!ts.isPropertyAssignment(item)) return []
        const name = propertyName(item.name)
        const reference = ts.isIdentifier(item.initializer) ? item.initializer.text : undefined
        return name || reference ? [{ ...(name ? { name } : {}), reference: reference ?? name }] : []
      },
  )
  const names = contributions.flatMap((item) => item.name ?? [])
  const references = contributions.flatMap((item) => item.reference ?? [])
  return {
    facts: {
      hasTools: true,
      ...(dynamic ? { dynamic } : {}),
      ...(names.length > 0 ? { names } : {}),
      ...(references.length > 0 ? { variables: references } : {}),
    },
    references,
  }
}

/** Follows simple local/imported factory calls that return an object-literal tool map. */
function toolContributionsFromFactoryCall(
  ctx: ExtractContext,
  call: ts.CallExpression,
  seen: ReadonlySet<string>,
): ToolExtraction {
  const callName = expressionName(call.expression)
  const staticCtx = internalStaticCallContext(ctx)
  if (!callName || !staticCtx) return { facts: { hasTools: true, dynamic: true }, references: [] }
  const key = `${staticCtx.file}:${callName}`
  if (seen.has(key)) return { facts: { hasTools: true, dynamic: true }, references: [] }
  const resolved = resolveIdentifierSourceNode(
    staticCtx.root,
    staticCtx.file,
    staticCtx.sourceFile,
    callName,
    staticCtx.localInitializers,
  )
  if (!resolved || !ts.isFunctionDeclaration(resolved.node)) return { facts: { hasTools: true, dynamic: true }, references: [] }
  const object = returnedToolObjectFromFunction(resolved.node, resolved.localInitializers)
  if (!object) return { facts: { hasTools: true, dynamic: true }, references: [] }
  return toolContributionsFromExpression(object, ctx, new Set([...seen, key]))
}

/** Finds a statically visible object map returned by a factory function. */
function returnedToolObjectFromFunction(
  declaration: ts.FunctionDeclaration,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.ObjectLiteralExpression | undefined {
  const returned: ts.ObjectLiteralExpression[] = []
  if (!declaration.body) return undefined
  const functionInitializers = new Map(localInitializers)
  collectFunctionScopedInitializers(declaration.body, functionInitializers)
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = resolveFactoryExpression(node.expression, functionInitializers)
      if (ts.isObjectLiteralExpression(expression)) returned.push(expression)
    }
    ts.forEachChild(node, visit)
  }
  visit(declaration.body)
  return returned.sort((a, b) => b.properties.length - a.properties.length)[0]
}

/** Resolves return expressions such as `return allTools` to the local object literal. */
function resolveFactoryExpression(
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression {
  const unwrapped = ts.isParenthesizedExpression(expression) ? expression.expression : expression
  return ts.isIdentifier(unwrapped) ? (localInitializers.get(unwrapped.text) ?? unwrapped) : unwrapped
}

/** Collects local constants from a factory body for simple return-object resolution. */
function collectFunctionScopedInitializers(node: ts.Node, localInitializers: Map<string, ts.Expression>): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    localInitializers.set(node.name.text, node.initializer)
  }
  ts.forEachChild(node, (child) => collectFunctionScopedInitializers(child, localInitializers))
}

/**
 * Unwraps syntax forms that can statically produce an injection return object.
 *
 * Parenthesized arrow returns are common for `inject: () => ({ ... })`. Expression-bodied callbacks are scanned for
 * the first object literal with injection-like keys so simple wrapper expressions can still be indexed.
 */
function returnedObjectLiteral(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  if (ts.isParenthesizedExpression(expression)) return returnedObjectLiteral(expression.expression)
  if (ts.isObjectLiteralExpression(expression)) return expression
  if (ts.isArrowFunction(expression)) {
    if (ts.isObjectLiteralExpression(expression.body)) return expression.body
    if (ts.isParenthesizedExpression(expression.body)) return returnedObjectLiteral(expression.body.expression)
    if (ts.isExpression(expression.body)) return firstInjectionObject(expression.body)
    if (ts.isBlock(expression.body)) return returnedObjectFromBlock(expression.body)
  }
  if (ts.isFunctionExpression(expression)) return returnedObjectFromBlock(expression.body)
  return undefined
}

/** Reads a block-bodied callback and returns the first statically visible returned injection object. */
function returnedObjectFromBlock(block: ts.Block): ts.ObjectLiteralExpression | undefined {
  for (const statement of block.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      const returned = returnedObjectLiteral(statement.expression) ?? firstInjectionObject(statement.expression)
      if (returned) return returned
    }
  }
  return undefined
}

/**
 * Finds the first injection-shaped object literal below a TypeScript node.
 *
 * This is intentionally an internal traversal helper, not a public extension API. TypeScript exposes child traversal
 * through callbacks, so the small local assignment is contained here while the extractor-facing API remains immutable.
 */
function firstInjectionObject(node: ts.Node): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(node) && isInjectionObject(node)) return node
  let found: ts.ObjectLiteralExpression | undefined
  ts.forEachChild(node, (child) => {
    if (!found) found = firstInjectionObject(child)
  })
  return found
}

/** Checks whether an object literal resembles an injectable contribution object. */
function isInjectionObject(object: ts.ObjectLiteralExpression): boolean {
  return object.properties.some(
    (item) =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) &&
      ['contexts', 'tools', 'constraints', 'guardrails', 'metadata'].includes(propertyName(item.name) ?? ''),
  )
}

/** Checks whether a known object literal has a property or shorthand with the requested stable name. */
function hasObjectProperty(object: ts.ObjectLiteralExpression, property: string): boolean {
  return object.properties.some((item) => {
    if (!ts.isPropertyAssignment(item) && !ts.isShorthandPropertyAssignment(item)) return false
    return propertyName(item.name) === property
  })
}

/** Chooses the default relation type before the resolver has target-kind information. */
function relationTypeForHint(owner: InjectionOwner, hint: InjectionUseFacts['relationHint']): string {
  switch (hint) {
    case 'injectable':
      return `${owner}.uses_injectable`
    case 'memory':
      return `${owner}.uses_memory`
    case 'blackboard':
      return `${owner}.uses_blackboard`
    case 'context':
    case 'unknown':
    default:
      return `${owner}.uses_context`
  }
}

/** Returns the target-kind relation overrides used once relation binding identifies the target definition kind. */
function relationTypesByTargetKind(owner: InjectionOwner): StaticRelationRef['typeByTargetKind'] {
  return {
    context: `${owner}.uses_context`,
    injectable: `${owner}.uses_injectable`,
    memory: `${owner}.uses_memory`,
    blackboard: `${owner}.uses_blackboard`,
  }
}

/** Reads a property expression from the current extractor config object. */
function propertyExpression(ctx: ExtractContext, property: string): ts.Expression | undefined {
  const object = internalStaticCallContext(ctx)?.objectArg
  return object ? propertyExpressionFromObject(object, property) : undefined
}

/** Reads a named property initializer from a known object literal. */
function propertyExpressionFromObject(object: ts.ObjectLiteralExpression, property: string): ts.Expression | undefined {
  const assignment = object.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === property,
  )
  return assignment?.initializer
}

/** Resolves one level of local constant indirection for helper expressions. */
function resolveLocalExpression(ctx: ExtractContext, expression: ts.Expression): ts.Expression {
  return ts.isIdentifier(expression) ? (localInitializers(ctx).get(expression.text) ?? expression) : expression
}

/** Returns source-local initializers from the compiler-owned native static context. */
function localInitializers(ctx: ExtractContext): ReadonlyMap<string, ts.Expression> {
  return internalStaticCallContext(ctx)?.localInitializers ?? new Map()
}

/** Returns the authored callee name for simple function and property-access calls. */
function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}
