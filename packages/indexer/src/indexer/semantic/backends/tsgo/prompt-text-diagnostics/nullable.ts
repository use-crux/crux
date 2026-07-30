import {
  SyntaxKind,
  isArrayLiteralExpression,
  isArrayTypeNode,
  isAsExpression,
  isCallExpression,
  isIdentifier,
  isLiteralTypeNode,
  isNamedTupleMember,
  isNonNullExpression,
  isNullLiteral,
  isOptionalTypeNode,
  isParenthesizedExpression,
  isParenthesizedTypeNode,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isSatisfiesExpression,
  isSignatureDeclaration,
  isTupleTypeNode,
  isTypeAliasDeclaration,
  isTypeAssertion,
  isTypeOperatorNode,
  isTypeReferenceNode,
  isUnionTypeNode,
  isVariableDeclaration,
  type Expression,
  type Node,
  type TypeNode,
} from "@typescript/native-preview/unstable/ast";
import type { Checker } from "@typescript/native-preview/unstable/sync";
import type { TsgoSemanticCompilerView } from "../compiler-view";
import { nativeNodeList } from "../source";

/**
 * Detects authored nullable element domains erased by non-strict checking.
 *
 * The syntax proof follows immutable value aliases and type aliases, but fails
 * closed on cycles or declarations that do not expose an exact authored type.
 */
export function hasExplicitNullableType(
  expression: Expression,
  checker: Checker,
  view: TsgoSemanticCompilerView,
): boolean {
  return expressionHasNullableType(expression, checker, view, new Set());
}

function expressionHasNullableType(
  expression: Expression,
  checker: Checker,
  view: TsgoSemanticCompilerView,
  active: ReadonlySet<string>,
): boolean {
  if (
    isAsExpression(expression) ||
    isTypeAssertion(expression) ||
    isSatisfiesExpression(expression)
  ) {
    return (
      nullableTypeNode(expression.type, view, new Set()) ||
      expressionHasNullableType(expression.expression, checker, view, active)
    );
  }
  if (
    isParenthesizedExpression(expression) ||
    isNonNullExpression(expression)
  ) {
    return expressionHasNullableType(
      expression.expression,
      checker,
      view,
      active,
    );
  }
  if (
    isArrayLiteralExpression(expression) &&
    nativeNodeList(expression.elements).some(
      (element) =>
        isNullLiteral(element) ||
        (isIdentifier(element) && element.text === "undefined"),
    )
  ) {
    return true;
  }
  if (isCallExpression(expression)) {
    const declaration = checker
      .getResolvedSignature(expression)
      ?.declaration?.resolve();
    if (
      declaration &&
      isSignatureDeclaration(declaration) &&
      declaration.type &&
      nullableTypeNode(declaration.type, view, new Set())
    ) {
      return true;
    }
  }

  const symbol = view.resolvedSymbols([expression])[0];
  if (!symbol) return false;
  const declarations = view.declarationsOf([symbol])[0] ?? [];
  return declarations.some((declaration) => {
    const key = nodeKey(declaration);
    if (active.has(key)) return false;
    const nextActive = new Set(active).add(key);
    const type = declarationType(declaration);
    if (type && nullableTypeNode(type, view, new Set())) return true;
    return (
      isVariableDeclaration(declaration) &&
      Boolean(
        declaration.initializer &&
          expressionHasNullableType(
            declaration.initializer,
            checker,
            view,
            nextActive,
          ),
      )
    );
  });
}

function nullableTypeNode(
  node: TypeNode,
  view: TsgoSemanticCompilerView,
  active: ReadonlySet<string>,
): boolean {
  if (
    node.kind === SyntaxKind.NullKeyword ||
    node.kind === SyntaxKind.UndefinedKeyword
  ) {
    return true;
  }
  if (isLiteralTypeNode(node) && isNullLiteral(node.literal)) return true;
  if (isUnionTypeNode(node)) {
    return nativeNodeList(node.types).some((member) =>
      nullableTypeNode(member, view, active),
    );
  }
  if (isArrayTypeNode(node)) {
    return nullableTypeNode(node.elementType, view, active);
  }
  if (isParenthesizedTypeNode(node) || isTypeOperatorNode(node)) {
    return nullableTypeNode(node.type, view, active);
  }
  if (isTupleTypeNode(node)) {
    return nativeNodeList(node.elements).some((element) => {
      if (isNamedTupleMember(element)) {
        return (
          Boolean(element.questionToken) ||
          nullableTypeNode(element.type, view, active)
        );
      }
      return isOptionalTypeNode(element)
        ? true
        : nullableTypeNode(element, view, active);
    });
  }
  if (!isTypeReferenceNode(node)) return false;
  if (
    isIdentifier(node.typeName) &&
    (node.typeName.text === "Array" ||
      node.typeName.text === "ReadonlyArray")
  ) {
    return nativeNodeList(node.typeArguments ?? []).some((argument) =>
      nullableTypeNode(argument, view, active),
    );
  }

  const symbol = view.resolvedSymbols([node.typeName])[0];
  if (!symbol) return false;
  return (view.declarationsOf([symbol])[0] ?? []).some((declaration) => {
    if (!isTypeAliasDeclaration(declaration)) return false;
    const key = nodeKey(declaration);
    if (active.has(key)) return false;
    return nullableTypeNode(
      declaration.type,
      view,
      new Set(active).add(key),
    );
  });
}

function declarationType(node: Node): TypeNode | undefined {
  if (
    isVariableDeclaration(node) ||
    isPropertyDeclaration(node) ||
    isPropertySignatureDeclaration(node) ||
    isSignatureDeclaration(node)
  ) {
    return node.type;
  }
  return undefined;
}

function nodeKey(node: Node): string {
  return `${node.getSourceFile().fileName}:${node.pos}:${node.end}:${node.kind}`;
}
