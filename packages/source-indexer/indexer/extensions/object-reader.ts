import ts from 'typescript'
import { identifierArrayProperty, identifierProperty, propertyName, stringArrayProperty, stringProperty } from '../ast/literals'
import type { StaticObjectReader } from './types'

export function createStaticObjectReader(object: ts.ObjectLiteralExpression | undefined): StaticObjectReader | undefined {
  if (!object) return undefined
  return {
    has: (property) =>
      object.properties.some((item) => {
        if (!ts.isPropertyAssignment(item) && !ts.isShorthandPropertyAssignment(item)) return false
        return propertyName(item.name) === property
      }),
    string: (property) => stringProperty(object, property),
    stringArray: (property) => stringArrayProperty(object, property) ?? [],
    identifier: (property) => identifierProperty(object, property),
    identifierArray: (property) => identifierArrayProperty(object, property),
    json: (property) => staticJson(object, property),
  }
}

function staticJson(object: ts.ObjectLiteralExpression, property: string | undefined): unknown {
  const value = property ? propertyExpression(object, property) : object
  return value ? expressionJson(value) : undefined
}

function propertyExpression(object: ts.ObjectLiteralExpression, property: string): ts.Expression | undefined {
  const found = object.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === property,
  )
  return found?.initializer
}

function expressionJson(expression: ts.Expression): unknown {
  if (ts.isStringLiteralLike(expression)) return expression.text
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isNumericLiteral(expression)) return Number(expression.text)
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.map((item) => expressionJson(item as ts.Expression))
  if (ts.isObjectLiteralExpression(expression)) {
    const entries = expression.properties.flatMap((item): Array<[string, unknown]> => {
      if (!ts.isPropertyAssignment(item)) return []
      const name = propertyName(item.name)
      return name ? [[name, expressionJson(item.initializer)]] : []
    })
    return Object.fromEntries(entries)
  }
  return undefined
}
