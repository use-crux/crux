import type { SemanticAnalyzerNode, SemanticAnalyzerView } from "../candidates";
import { semanticPropertyName } from "../syntax-readers";

/** Resolves one accepted terminal-const prompt-text fragment shape. */
export function promptTextNamedFragment(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): { readonly tag: SemanticAnalyzerNode<SemanticAnalyzerView> } | undefined {
  if (view.syntax.isKind(expression, "identifier")) {
    const declaration = resolvedDeclaration(expression, view);
    return declaration ? directConstTag(declaration, view) : undefined;
  }
  if (!view.syntax.isKind(expression, "propertyAccessExpression")) {
    return undefined;
  }

  const receiver = view.syntax.propertyAccessExpression(expression);
  const propertyName = view.syntax.propertyAccessName(expression);
  if (!receiver || !propertyName) return undefined;
  const base = view.syntax.unwrapExpression(receiver);
  if (!view.syntax.isKind(base, "identifier")) return undefined;
  const declaration = resolvedDeclaration(base, view);
  if (
    !declaration ||
    view.syntax.variableDeclarationKind(declaration) !== "const"
  ) {
    return undefined;
  }

  const initializer = view.syntax.variableDeclarationInitializer(declaration);
  const object = initializer && view.syntax.unwrapExpression(initializer);
  if (!object || !view.syntax.isKind(object, "objectLiteral")) return undefined;
  const property = view.syntax
    .objectProperties(object)
    .find(
      (entry) =>
        view.syntax.isKind(entry, "propertyAssignment") &&
        semanticPropertyName(entry, view.syntax) === propertyName,
    );
  const value = property && view.syntax.propertyInitializer(property);
  const tag = value && view.syntax.unwrapExpression(value);
  return tag && view.syntax.isKind(tag, "taggedTemplate") ? { tag } : undefined;
}

/** Resolves an inline or terminal-const prompt callback without executing it. */
export function promptTextCallbackExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const unwrapped = view.syntax.unwrapExpression(expression);
  if (view.syntax.isFunctionLike(unwrapped)) return unwrapped;
  if (!view.syntax.isKind(unwrapped, "identifier")) return undefined;

  const declaration = resolvedDeclaration(unwrapped, view);
  if (!declaration) return undefined;
  if (view.syntax.isFunctionLike(declaration)) return declaration;
  if (view.syntax.variableDeclarationKind(declaration) !== "const") {
    return undefined;
  }
  const initializer = view.syntax.variableDeclarationInitializer(declaration);
  const callback = initializer && view.syntax.unwrapExpression(initializer);
  return callback && view.syntax.isFunctionLike(callback)
    ? callback
    : undefined;
}

function directConstTag(
  declaration: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): { readonly tag: SemanticAnalyzerNode<SemanticAnalyzerView> } | undefined {
  if (view.syntax.variableDeclarationKind(declaration) !== "const") {
    return undefined;
  }
  const initializer = view.syntax.variableDeclarationInitializer(declaration);
  const tag = initializer && view.syntax.unwrapExpression(initializer);
  return tag && view.syntax.isKind(tag, "taggedTemplate") ? { tag } : undefined;
}

function resolvedDeclaration(
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const symbol = view.resolvedSymbols([node])[0];
  return symbol ? view.declarationsOf([symbol])[0]?.[0] : undefined;
}
