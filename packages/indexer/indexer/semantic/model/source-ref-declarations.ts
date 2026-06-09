import ts from 'typescript'
import { propertyName } from '../../ast/literals'

/**
 * Returns the initializer expression for an object property, accepting both
 * explicit and shorthand property syntax.
 */
export function propertyInitializer(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === name,
  )
  if (!property) return undefined
  return ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
}

/** Returns the simple callee name for call and constructor expressions. */
export function callExpressionName(node: ts.CallExpression | ts.NewExpression): string | undefined {
  if (ts.isIdentifier(node.expression)) return node.expression.text
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text
  return undefined
}

/** Infers the authored variable/property name associated with an AST node. */
export function variableNameForNode(node: ts.Node): string | undefined {
  const parent = node.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
  if (ts.isPropertyAssignment(parent)) return propertyName(parent.name)
  return undefined
}

/** Removes TypeScript expression wrappers that do not affect semantic identity. */
export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression
  }
  return current
}

/** Checks whether an expression can be resolved to a source declaration. */
export function isResolvableSourceExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression)
  return ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped)
}

/** Returns the display/source symbol name for supported source-ref declarations. */
export function symbolNameForDeclaration(node: ts.Declaration): string | undefined {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text
  if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node)) {
    return propertyName(node.name)
  }
  return undefined
}

/** Returns whether a declaration kind can be represented as source-ref evidence. */
export function isSourceRefDeclaration(node: ts.Declaration): boolean {
  return (
    ts.isVariableDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isMethodDeclaration(node)
  )
}

/** Returns the expression carried by declaration forms that have inline values. */
export function expressionFromDeclaration(node: ts.Declaration): ts.Expression | undefined {
  if (ts.isVariableDeclaration(node)) return node.initializer
  if (ts.isPropertyAssignment(node)) return node.initializer
  if (ts.isShorthandPropertyAssignment(node)) return node.name
  return undefined
}

/** Returns the function name represented by function-like source declarations. */
export function functionNameForDeclaration(node: ts.Declaration): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text
  if (ts.isMethodDeclaration(node)) return propertyName(node.name)
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const initializer = unwrapExpression(node.initializer)
    if ((ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) && ts.isIdentifier(node.name)) {
      return node.name.text
    }
  }
  if (ts.isPropertyAssignment(node)) {
    const initializer = unwrapExpression(node.initializer)
    if (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) return propertyName(node.name)
  }
  return undefined
}
