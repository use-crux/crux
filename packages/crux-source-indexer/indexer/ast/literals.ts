import ts from 'typescript'

export function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

export function stringProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property) return undefined
  return ts.isStringLiteralLike(property.initializer) ? property.initializer.text : undefined
}

export function hasProperty(object: ts.ObjectLiteralExpression, name: string): boolean {
  return object.properties.some((item) => (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === name)
}

export function numberProperty(object: ts.ObjectLiteralExpression, name: string): number | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property) return undefined
  return numericLiteralValue(property.initializer)
}

export function nestedStringProperty(object: ts.ObjectLiteralExpression, path: readonly string[]): string | undefined {
  let current: ts.Expression | undefined = object
  for (const segment of path) {
    if (!current || !ts.isObjectLiteralExpression(current)) return undefined
    const property: ts.PropertyAssignment | undefined = current.properties.find(
      (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === segment,
    )
    if (!property) return undefined
    current = property.initializer
  }
  return current && ts.isStringLiteralLike(current) ? current.text : undefined
}

export function numericLiteralValue(expression: ts.Expression | undefined): number | undefined {
  return expression && ts.isNumericLiteral(expression) ? Number(expression.text) : undefined
}

export function literalValue(expression: ts.Expression | undefined): unknown {
  if (!expression) return undefined
  if (ts.isStringLiteralLike(expression)) return expression.text
  if (ts.isNumericLiteral(expression)) return Number(expression.text)
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false
  return undefined
}

export function stringArrayProperty(object: ts.ObjectLiteralExpression, name: string): string[] | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property || !ts.isArrayLiteralExpression(property.initializer)) return undefined
  const values = property.initializer.elements.filter((element): element is ts.StringLiteral => ts.isStringLiteral(element)).map((element) => element.text)
  return values.length > 0 ? values : undefined
}

export function identifierArrayProperty(object: ts.ObjectLiteralExpression, name: string): string[] {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property || !ts.isArrayLiteralExpression(property.initializer)) return []
  return identifierArrayElements(property.initializer)
}

export function identifierArrayElements(array: ts.ArrayLiteralExpression): string[] {
  return array.elements.filter((element): element is ts.Identifier => ts.isIdentifier(element)).map((element) => element.text)
}

export function identifierProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property || !ts.isIdentifier(property.initializer)) return undefined
  return property.initializer.text
}

export function toolNamesProperty(object: ts.ObjectLiteralExpression, name: string): string[] | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property) return undefined
  if (ts.isArrayLiteralExpression(property.initializer)) return identifierArrayElements(property.initializer)
  if (ts.isObjectLiteralExpression(property.initializer)) {
    const names = property.initializer.properties
      .map((item) => (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item) ? propertyName(item.name) : undefined))
      .filter((value): value is string => typeof value === 'string')
    return names.length > 0 ? names : undefined
  }
  return undefined
}
