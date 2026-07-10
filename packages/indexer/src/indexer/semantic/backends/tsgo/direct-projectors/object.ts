import {
  isCallExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isStringLiteral,
  type Expression,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type PropertyName,
  type ShorthandPropertyAssignment,
} from '@typescript/native-preview/unstable/ast'
import {
  nativeDirectPrimitiveForCallName,
  type NativeDirectPrimitiveSpec,
} from './manifest'
import { nativeNodeList } from '../source'

export interface NativeCruxCall {
  readonly primitive: NativeDirectPrimitiveSpec
  readonly object: ObjectLiteralExpression
}

/** Returns a supported first-party direct Crux call from a native expression. */
export function nativeCruxCall(expression: Expression): NativeCruxCall | undefined {
  if (!isCallExpression(expression) || !isIdentifier(expression.expression)) return undefined
  const primitive = nativeDirectPrimitiveForCallName(expression.expression.text)
  if (!primitive) return undefined
  const args = nativeNodeList(expression.arguments)
  const object = primitive.callName === 'fallback' ? nativeFallbackOptions(args) : args[0]
  return object && isObjectLiteralExpression(object) ? { primitive, object } : undefined
}

/** Resolves the Project Index name for one direct primitive definition. */
export function definitionName(
  primitive: NativeDirectPrimitiveSpec,
  object: ObjectLiteralExpression,
  variableName: string,
): string | undefined {
  for (const property of primitive.nameProperties) {
    const name = stringProperty(object, property)
    if (name) return name
  }
  return variableName
}

/** Returns an object property's initializer for supported native property names. */
export function propertyInitializer(object: ObjectLiteralExpression, name: string): Expression | undefined {
  const property = nativeNodeList(object.properties).find(
    (candidate): candidate is PropertyAssignment | ShorthandPropertyAssignment =>
      (isPropertyAssignment(candidate) || isShorthandPropertyAssignment(candidate)) &&
      propertyName(candidate.name) === name,
  )
  return property && isShorthandPropertyAssignment(property)
    ? isIdentifier(property.name)
      ? property.name
      : undefined
    : property?.initializer
}

/** Returns a string literal property value. */
export function stringProperty(object: ObjectLiteralExpression, name: string): string | undefined {
  const initializer = propertyInitializer(object, name)
  return initializer && isStringLiteral(initializer) ? initializer.text : undefined
}

/** Returns a supported native object property name. */
export function propertyName(name: PropertyName): string | undefined {
  if (isIdentifier(name) || isStringLiteral(name)) return name.text
  return undefined
}

function nativeFallbackOptions(args: readonly Expression[]): Expression | undefined {
  const last = args.at(-1)
  if (!last || !isObjectLiteralExpression(last)) return undefined
  const hasOptionsShape = Boolean(
    stringProperty(last, 'id') ||
      stringProperty(last, 'description') ||
      propertyInitializer(last, 'timeout') ||
      propertyInitializer(last, 'timeoutMs') ||
      propertyInitializer(last, 'on') ||
      propertyInitializer(last, 'shouldFallback') ||
      propertyInitializer(last, 'onAttemptError'),
  )
  return hasOptionsShape ? last : undefined
}
