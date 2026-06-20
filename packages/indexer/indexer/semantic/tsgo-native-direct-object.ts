import {
  isCallExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isStringLiteral,
  type Expression,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type PropertyName,
} from '@typescript/native-preview/unstable/ast'
import {
  nativeDirectPrimitiveForCallName,
  type NativeDirectPrimitiveSpec,
} from './tsgo-native-direct-manifest'
import { nativeNodeList } from './tsgo-native-source'

export interface NativeCruxCall {
  readonly primitive: NativeDirectPrimitiveSpec
  readonly object: ObjectLiteralExpression
}

/** Returns a supported first-party direct Crux call from a native expression. */
export function nativeCruxCall(expression: Expression): NativeCruxCall | undefined {
  if (!isCallExpression(expression) || !isIdentifier(expression.expression)) return undefined
  const primitive = nativeDirectPrimitiveForCallName(expression.expression.text)
  if (!primitive) return undefined
  const [arg] = nativeNodeList(expression.arguments)
  return arg && isObjectLiteralExpression(arg) ? { primitive, object: arg } : undefined
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
    (candidate): candidate is PropertyAssignment =>
      isPropertyAssignment(candidate) && propertyName(candidate.name) === name,
  )
  return property?.initializer
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
