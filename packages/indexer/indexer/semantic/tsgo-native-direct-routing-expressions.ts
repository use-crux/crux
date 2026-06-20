import {
  isArrayLiteralExpression,
  isCallExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  type ArrayLiteralExpression,
  type Expression,
  type ObjectLiteralElementLike,
  type ObjectLiteralExpression,
} from '@typescript/native-preview/unstable/ast'
import { propertyInitializer, propertyName } from './tsgo-native-direct-object'
import { nativeDirectSourceRefForExpression } from './tsgo-native-direct-source-refs'
import { nativeNodeList } from './tsgo-native-source'
import type { NativeDefinition, NativeSourceBinding, SourceRefFact } from './tsgo-native-direct-types'

/** Result type for direct native routing resolution; `unsupported` asks the shared analyzer to handle it. */
export type Resolved<TValue> = TValue | 'unsupported'

/** Resolves a local routing target expression to an indexed definition when direct evidence is enough. */
export function targetForExpression(
  expression: Expression,
  definitions: ReadonlyMap<string, NativeDefinition>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
  seen: ReadonlySet<string> = new Set(),
): Resolved<NativeDefinition | undefined> {
  if (isIdentifier(expression)) return definitions.get(expression.text)
  if (isPropertyAccessExpression(expression) && isIdentifier(expression.expression)) {
    const key = `${expression.expression.text}.${expression.name.text}`
    if (seen.has(key)) return 'unsupported'
    const property = objectPropertyValue(bindings.get(expression.expression.text), expression.name.text)
    return property ? targetForExpression(property, definitions, bindings, new Set([...seen, key])) : undefined
  }
  return isCallExpression(expression) ? 'unsupported' : undefined
}

/** Builds a routing/source-ref fact or returns `unsupported` for resolvable non-local expressions. */
export function sourceRefForExpression(
  definitionId: string,
  role: SourceRefFact['ref']['role'],
  property: string,
  expression: Expression,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
  metadata?: SourceRefFact['ref']['metadata'],
): Resolved<SourceRefFact | undefined> {
  const ref = nativeDirectSourceRefForExpression({ definitionId, role, property, expression, bindings, metadata })
  if (ref) return ref
  return isResolvableSourceExpression(expression) ? 'unsupported' : undefined
}

/** Reads an object-valued property, following same-file constant bindings. */
export function objectPropertyExpression(
  object: ObjectLiteralExpression,
  property: string,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): Resolved<ObjectLiteralExpression | undefined> {
  const expression = propertyInitializer(object, property)
  return expression ? objectExpression(expression, bindings) : undefined
}

/** Reads an array-valued property, following same-file constant bindings. */
export function arrayPropertyExpression(
  object: ObjectLiteralExpression,
  property: string,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): Resolved<ArrayLiteralExpression | undefined> {
  const expression = propertyInitializer(object, property)
  return expression ? arrayExpression(expression, bindings) : undefined
}

/** Returns the value expression carried by a supported object-literal member. */
export function propertyExpression(property: ObjectLiteralElementLike): Expression | undefined {
  if (isPropertyAssignment(property)) return property.initializer
  if (isShorthandPropertyAssignment(property) && isIdentifier(property.name)) return property.name
  return undefined
}

/** Returns the static name for routing object members that can author child ids. */
export function propertyNameForRoutingMember(property: ObjectLiteralElementLike): string | undefined {
  return isPropertyAssignment(property) || isShorthandPropertyAssignment(property) ? propertyName(property.name) : undefined
}

function objectExpression(
  expression: Expression,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
  seen: ReadonlySet<string> = new Set(),
): Resolved<ObjectLiteralExpression | undefined> {
  if (isObjectLiteralExpression(expression)) return expression
  if (!isIdentifier(expression)) return isResolvableSourceExpression(expression) ? 'unsupported' : undefined
  const next = nextBoundExpression(expression.text, bindings, seen)
  return next === 'unsupported' || !next ? next : objectExpression(next, bindings, new Set([...seen, expression.text]))
}

function arrayExpression(
  expression: Expression,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
  seen: ReadonlySet<string> = new Set(),
): Resolved<ArrayLiteralExpression | undefined> {
  if (isArrayLiteralExpression(expression)) return expression
  if (!isIdentifier(expression)) return isResolvableSourceExpression(expression) ? 'unsupported' : undefined
  const next = nextBoundExpression(expression.text, bindings, seen)
  return next === 'unsupported' || !next ? next : arrayExpression(next, bindings, new Set([...seen, expression.text]))
}

function nextBoundExpression(
  name: string,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
  seen: ReadonlySet<string>,
): Resolved<Expression | undefined> {
  if (seen.has(name)) return 'unsupported'
  const binding = bindings.get(name)
  return binding ? binding.initializer : 'unsupported'
}

function objectPropertyValue(owner: NativeSourceBinding | undefined, property: string): Expression | undefined {
  return owner?.initializer && isObjectLiteralExpression(owner.initializer)
    ? nativeNodeList(owner.initializer.properties)
        .map((member) => (propertyNameForRoutingMember(member) === property ? propertyExpression(member) : undefined))
        .find((value): value is Expression => Boolean(value))
    : undefined
}

function isResolvableSourceExpression(expression: Expression): boolean {
  return isIdentifier(expression) || isPropertyAccessExpression(expression)
}
