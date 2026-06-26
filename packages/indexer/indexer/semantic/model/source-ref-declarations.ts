import type { SemanticAnalyzerNode, SemanticAnalyzerView } from '../candidates'
import {
  semanticIsResolvableSourceExpression,
  semanticNodeName,
  semanticPropertyInitializer,
  semanticPropertyName,
  semanticVariableNameForNode,
} from '../syntax-readers'

/** Returns the initializer expression for an object property. */
export function propertyInitializer(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  return semanticPropertyInitializer(object, name, view.syntax)
}

/** Returns the simple callee name for call and constructor expressions. */
export function callExpressionName(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): string | undefined {
  return view.syntax.callExpressionName(node)
}

/** Infers the authored variable/property name associated with a syntax node. */
export function variableNameForNode(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): string | undefined {
  return semanticVariableNameForNode(node, view.syntax)
}

/** Removes expression wrappers that do not affect semantic identity. */
export function unwrapExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> {
  return view.syntax.unwrapExpression(expression)
}

/** Checks whether an expression can be resolved to a source declaration. */
export function isResolvableSourceExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): boolean {
  return semanticIsResolvableSourceExpression(expression, view.syntax)
}

/** Returns the display/source symbol name for supported declarations. */
export function symbolNameForDeclaration(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): string | undefined {
  const name = view.syntax.declarationName(node) ?? view.syntax.propertyName(node)
  return name ? semanticNodeName(name, view.syntax) : undefined
}

/** Returns whether a declaration kind can be represented as source-ref evidence. */
export function isSourceRefDeclaration(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): boolean {
  const kind = view.syntax.kind(node)
  return (
    kind === 'variableDeclaration' ||
    kind === 'functionDeclaration' ||
    kind === 'propertyAssignment' ||
    kind === 'shorthandPropertyAssignment' ||
    kind === 'methodDeclaration'
  )
}

/** Returns the expression carried by declaration forms with inline values. */
export function expressionFromDeclaration(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  if (view.syntax.isKind(node, 'variableDeclaration')) return view.syntax.variableDeclarationInitializer(node)
  if (view.syntax.isKind(node, 'propertyAssignment') || view.syntax.isKind(node, 'shorthandPropertyAssignment')) {
    return view.syntax.propertyInitializer(node)
  }
  return undefined
}

/** Returns the function name represented by function-like source declarations. */
export function functionNameForDeclaration(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): string | undefined {
  if (view.syntax.isKind(node, 'functionDeclaration')) {
    const name = view.syntax.declarationName(node)
    return name ? semanticNodeName(name, view.syntax) : undefined
  }
  if (view.syntax.isKind(node, 'methodDeclaration')) {
    const name = view.syntax.propertyName(node)
    return name ? semanticNodeName(name, view.syntax) : undefined
  }
  if (view.syntax.isKind(node, 'variableDeclaration')) {
    const initializer = view.syntax.variableDeclarationInitializer(node)
    const name = view.syntax.variableDeclarationName(node)
    return initializer && name && view.syntax.isFunctionLike(view.syntax.unwrapExpression(initializer))
      ? semanticNodeName(name, view.syntax)
      : undefined
  }
  if (view.syntax.isKind(node, 'propertyAssignment')) {
    const initializer = view.syntax.propertyInitializer(node)
    return initializer && view.syntax.isFunctionLike(view.syntax.unwrapExpression(initializer))
      ? semanticPropertyName(node, view.syntax)
      : undefined
  }
  return undefined
}
