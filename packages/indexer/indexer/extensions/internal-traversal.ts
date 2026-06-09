import ts from 'typescript'
import type { ExtractContext, StaticObjectReader } from './types'
import { createStaticObjectReader } from './object-reader'
import { propertyName } from '../ast/literals'
import { internalTypeScriptContext } from './internal-native'

/**
 * Narrow traversal facade for first-party extractors that still need source walks.
 *
 * This interface deliberately exposes query-like methods instead of raw visitors. Each method returns
 * immutable matches derived from the parser-owned call expression, keeping traversal logic isolated
 * while stable extractor APIs continue to prefer readers and builders.
 */
export interface InternalStaticTraversal {
  stringArgument(index: number): string | undefined
  identifierArgument(index: number): string | undefined
  objectArgument(index: number): StaticObjectReader | undefined
  callbackParameterName(argumentIndex: number, parameterIndex?: number): string | undefined
  collectCallsInArgument(argumentIndex: number, predicate: CallPredicate): readonly StaticCallMatch[]
  collectCallsInConfigProperty(property: string, predicate: CallPredicate): readonly StaticCallMatch[]
  collectCallsInArguments(startIndex: number, predicate: CallPredicate): readonly StaticCallMatch[]
}

/**
 * Minimal representation of a call found by internal traversal.
 *
 * The match captures only callee identity and literal/identifier arguments that first-party index
 * intelligence needs. It intentionally omits the AST node so callers cannot couple themselves to
 * parser-owned TypeScript structures.
 */
export interface StaticCallMatch {
  readonly name: string
  readonly stringArguments: readonly string[]
  readonly identifierArguments: readonly string[]
}

/**
 * Predicate used by internal traversal methods to find calls by callee and optional receiver.
 *
 * For example, `{ name: 'read', receiver: 'memory' }` matches `memory.read(...)`, while
 * `{ name: 'step' }` matches any call whose property or identifier name is `step`.
 */
export interface CallPredicate {
  readonly name?: string
  readonly receiver?: string
}

/** Exposes narrow compiler-owned traversal helpers to first-party extractors without making AST traversal public API. */
export function internalStaticTraversal(ctx: ExtractContext): InternalStaticTraversal | undefined {
  const native = internalTypeScriptContext(ctx)
  if (!native) return undefined

  return {
    stringArgument: (index) => {
      const argument = callArguments(native.call)[index]
      return argument && ts.isStringLiteralLike(argument) ? argument.text : undefined
    },
    identifierArgument: (index) => {
      const argument = callArguments(native.call)[index]
      return argument && ts.isIdentifier(argument) ? argument.text : undefined
    },
    objectArgument: (index) => {
      const argument = callArguments(native.call)[index]
      return argument && ts.isObjectLiteralExpression(argument) ? createStaticObjectReader(argument) : undefined
    },
    callbackParameterName: (argumentIndex, parameterIndex = 0) => {
      const callback = callArguments(native.call)[argumentIndex]
      if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) return undefined
      const parameterName = callback.parameters[parameterIndex]?.name
      return parameterName && ts.isIdentifier(parameterName) ? parameterName.text : undefined
    },
    collectCallsInArgument: (argumentIndex, predicate) => {
      const argument = callArguments(native.call)[argumentIndex]
      return argument ? collectCalls(argument, predicate) : []
    },
    collectCallsInConfigProperty: (property, predicate) => {
      const initializer = native.objectArg ? propertyInitializer(native.objectArg, property) : undefined
      return initializer ? collectCalls(initializer, predicate) : []
    },
    collectCallsInArguments: (startIndex, predicate) =>
      callArguments(native.call).slice(startIndex).flatMap((argument) => collectCalls(argument, predicate)),
  }
}

/**
 * Returns call or constructor arguments as an immutable array.
 */
function callArguments(expression: ts.Expression): readonly ts.Expression[] {
  return ts.isCallExpression(expression) || ts.isNewExpression(expression) ? [...(expression.arguments ?? [])] : []
}

/**
 * Recursively collects calls under a parser-owned node and returns source-order matches.
 *
 * The recursion returns arrays instead of pushing into caller-owned state so traversal remains a pure
 * computation from `root` and `predicate` to matches.
 */
function collectCalls(root: ts.Node, predicate: CallPredicate): StaticCallMatch[] {
  const current = ts.isCallExpression(root) ? callMatch(root, predicate) : undefined
  return [...(current ? [current] : []), ...childrenOf(root).flatMap((child) => collectCalls(child, predicate))]
}

/** Converts a TypeScript call expression into the stable internal match shape when it satisfies a predicate. */
function callMatch(call: ts.CallExpression, predicate: CallPredicate): StaticCallMatch | undefined {
  const name = callName(call)
  const receiver = callReceiver(call)
  if (!name || !matchesPredicate({ name, receiver }, predicate)) return undefined
  return {
    name,
    stringArguments: call.arguments
      .filter((argument): argument is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
        ts.isStringLiteralLike(argument),
      )
      .map((argument) => argument.text),
    identifierArguments: call.arguments
      .filter((argument): argument is ts.Identifier => ts.isIdentifier(argument))
      .map((argument) => argument.text),
  }
}

/**
 * Returns direct TypeScript children as an immutable array.
 *
 * TypeScript exposes children through a callback API, so this function is the only small adapter from
 * callback iteration into value-returning traversal.
 */
function childrenOf(node: ts.Node): readonly ts.Node[] {
  let children: readonly ts.Node[] = []
  ts.forEachChild(node, (child) => {
    children = [...children, child]
  })
  return children
}

/** Checks both optional predicate dimensions without treating missing receiver/name as a mismatch. */
function matchesPredicate(
  call: { readonly name: string; readonly receiver?: string },
  predicate: CallPredicate,
): boolean {
  return (
    (!predicate.name || call.name === predicate.name) && (!predicate.receiver || call.receiver === predicate.receiver)
  )
}

/** Reads the identifier or property name invoked by a call expression. */
function callName(call: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(call.expression)) return call.expression.text
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text
  return undefined
}

/** Reads the identifier receiver of a property access call such as `memory.read()`. */
function callReceiver(call: ts.CallExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined
  const receiver = call.expression.expression
  return ts.isIdentifier(receiver) ? receiver.text : undefined
}

/** Resolves a named config property to the expression traversal should inspect. */
function propertyInitializer(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === name,
  )
  if (!property) return undefined
  return ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
}
