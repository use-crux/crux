import {
  SyntaxKind,
  isIdentifier,
  isExpression,
  isNumericLiteral,
  isPrefixUnaryExpression,
  isTemplateExpression,
  isTrueLiteral,
  type Expression,
  type TemplateLiteral,
} from "@typescript/native-preview/unstable/ast";
import type { TsgoSemanticCompilerView } from "../compiler-view";
import { nativeNodeList } from "../source";
import { unwrapTransparentExpression } from "./json";

/** Returns whether native cooked quasis prove an inline interpolation. */
export function isInlineInterpolation(
  template: TemplateLiteral,
  interpolationIndex: number,
): boolean {
  if (!isTemplateExpression(template)) return false;
  const lines: Array<{ text: string; interpolations: number[] }> = [
    { text: "", interpolations: [] },
  ];
  appendCookedText(lines, template.head.text);
  nativeNodeList(template.templateSpans).forEach((span, index) => {
    lines.at(-1)?.interpolations.push(index);
    appendCookedText(lines, span.literal.text);
  });
  const line = lines.find((candidate) =>
    candidate.interpolations.includes(interpolationIndex),
  );
  return !(
    line &&
    line.interpolations.length === 1 &&
    /^[ \t]*$/.test(line.text)
  );
}

/** Proves the exact non-finite syntax accepted by the V1 contract. */
export function isExactNonFiniteNumber(
  expression: Expression,
  view: TsgoSemanticCompilerView,
): boolean {
  const unwrapped = unwrapTransparentExpression(expression);
  if (isNumericLiteral(unwrapped)) {
    return !Number.isFinite(Number(unwrapped.text));
  }
  if (isIdentifier(unwrapped)) {
    return (
      (unwrapped.text === "NaN" || unwrapped.text === "Infinity") &&
      isDefaultLibraryBinding(unwrapped, view)
    );
  }
  if (
    isPrefixUnaryExpression(unwrapped) &&
    (unwrapped.operator === SyntaxKind.PlusToken ||
      unwrapped.operator === SyntaxKind.MinusToken)
  ) {
    const operand = unwrapTransparentExpression(unwrapped.operand);
    return (
      isIdentifier(operand) &&
      operand.text === "Infinity" &&
      isDefaultLibraryBinding(operand, view)
    );
  }
  return false;
}

/** Proves a literal true expression or its single immutable local alias. */
export function isExactTrueExpression(
  expression: Expression,
  view: TsgoSemanticCompilerView,
): boolean {
  const unwrapped = unwrapTransparentExpression(expression);
  if (isTrueLiteral(unwrapped)) return true;
  if (!isIdentifier(unwrapped)) return false;
  const symbol = view.resolvedSymbols([unwrapped])[0];
  if (!symbol) return false;
  const declarations = view.declarationsOf([symbol])[0] ?? [];
  if (declarations.length !== 1) return false;
  const declaration = declarations[0];
  if (
    !declaration ||
    view.syntax.variableDeclarationKind(declaration) !== "const"
  ) {
    return false;
  }
  const initializer = view.syntax.variableDeclarationInitializer(declaration);
  return Boolean(
    initializer &&
      isExpression(initializer) &&
      isTrueLiteral(unwrapTransparentExpression(initializer)),
  );
}

function appendCookedText(
  lines: Array<{ text: string; interpolations: number[] }>,
  text: string,
): void {
  const parts = text.split(/\r\n|\r|\n/);
  const current = lines.at(-1);
  if (!current) return;
  current.text += parts[0] ?? "";
  for (const part of parts.slice(1)) {
    lines.push({ text: part, interpolations: [] });
  }
}

function isDefaultLibraryBinding(
  identifier: import("@typescript/native-preview/unstable/ast").Identifier,
  view: TsgoSemanticCompilerView,
): boolean {
  const symbol = view.resolvedSymbols([identifier])[0];
  if (!symbol) return false;
  const declarations = view.declarationsOf([symbol])[0] ?? [];
  return (
    declarations.length > 0 &&
    declarations.every((declaration) => {
      const sourceFile = declaration.getSourceFile();
      return (
        sourceFile.isDeclarationFile &&
        /(?:^|[/\\])lib\.[^/\\]+\.d\.ts$/.test(sourceFile.fileName)
      );
    })
  );
}
