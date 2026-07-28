import ts from "typescript";
import { unwrapTransparentExpression } from "./json";

/** Returns whether an interpolation is inline under Core's normalized rule. */
export function isInlineInterpolation(
  template: ts.TemplateLiteral,
  interpolationIndex: number,
): boolean {
  if (!ts.isTemplateExpression(template)) return false;
  const lines: Array<{ text: string; interpolations: number[] }> = [
    { text: "", interpolations: [] },
  ];
  appendCookedText(lines, template.head.text);
  template.templateSpans.forEach((span, index) => {
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

/** Proves the exact non-finite syntax accepted by the V1 construction rules. */
export function isExactNonFiniteNumber(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  const unwrapped = unwrapTransparentExpression(expression);
  if (ts.isNumericLiteral(unwrapped)) {
    return !Number.isFinite(Number(unwrapped.text));
  }
  if (ts.isIdentifier(unwrapped)) {
    return (
      (unwrapped.text === "NaN" || unwrapped.text === "Infinity") &&
      isDefaultLibraryBinding(unwrapped, checker)
    );
  }
  if (
    ts.isPrefixUnaryExpression(unwrapped) &&
    (unwrapped.operator === ts.SyntaxKind.PlusToken ||
      unwrapped.operator === ts.SyntaxKind.MinusToken)
  ) {
    const operand = unwrapTransparentExpression(unwrapped.operand);
    return (
      ts.isIdentifier(operand) &&
      operand.text === "Infinity" &&
      isDefaultLibraryBinding(operand, checker)
    );
  }
  return false;
}

/** Proves a whole expression is literal `true` without following mutable data. */
export function isExactTrueExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  const unwrapped = unwrapTransparentExpression(expression);
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (!ts.isIdentifier(unwrapped)) return false;
  const symbol = checker.getSymbolAtLocation(unwrapped);
  const declarations = symbol?.declarations;
  if (declarations?.length !== 1) return false;
  const declaration = declarations[0];
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !declaration.initializer ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    !(declaration.parent.flags & ts.NodeFlags.Const)
  ) {
    return false;
  }
  return (
    unwrapTransparentExpression(declaration.initializer).kind ===
    ts.SyntaxKind.TrueKeyword
  );
}

/** Detects authored nullable element domains erased by non-strict checking. */
export function hasExplicitNullableType(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  return expressionHasExplicitNullableType(expression, checker, new Set());
}

function expressionHasExplicitNullableType(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  active: ReadonlySet<ts.Symbol>,
): boolean {
  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return (
      nullableTypeNode(expression.type, checker, new Set()) ||
      expressionHasExplicitNullableType(expression.expression, checker, active)
    );
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return expressionHasExplicitNullableType(
      expression.expression,
      checker,
      active,
    );
  }
  if (
    ts.isArrayLiteralExpression(expression) &&
    expression.elements.some(
      (element) =>
        element.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isIdentifier(element) && element.text === "undefined"),
    )
  ) {
    return true;
  }
  if (ts.isCallExpression(expression)) {
    const declaration = checker.getResolvedSignature(expression)?.declaration;
    if (
      declaration &&
      "type" in declaration &&
      declaration.type &&
      ts.isTypeNode(declaration.type) &&
      nullableTypeNode(declaration.type, checker, new Set())
    ) {
      return true;
    }
  }
  const symbol = checker.getSymbolAtLocation(expression);
  if (!symbol || active.has(symbol)) return false;
  const nextActive = new Set(active).add(symbol);
  return Boolean(
    symbol?.declarations?.some((declaration) => {
      const typeNode =
        (ts.isVariableDeclaration(declaration) ||
          ts.isParameter(declaration) ||
          ts.isPropertyDeclaration(declaration) ||
          ts.isPropertySignature(declaration)) &&
        declaration.type;
      if (typeNode && nullableTypeNode(typeNode, checker, new Set())) {
        return true;
      }
      return (
        ts.isVariableDeclaration(declaration) &&
        Boolean(
          declaration.initializer &&
            expressionHasExplicitNullableType(
              declaration.initializer,
              checker,
              nextActive,
            ),
        )
      );
    }),
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

function nullableTypeNode(
  node: ts.TypeNode,
  checker: ts.TypeChecker,
  active: Set<ts.Symbol>,
): boolean {
  if (
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.UndefinedKeyword
  ) {
    return true;
  }
  if (
    ts.isLiteralTypeNode(node) &&
    node.literal.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isUnionTypeNode(node)) {
    return node.types.some((member) =>
      nullableTypeNode(member, checker, active),
    );
  }
  if (ts.isArrayTypeNode(node)) {
    return nullableTypeNode(node.elementType, checker, active);
  }
  if (ts.isParenthesizedTypeNode(node) || ts.isTypeOperatorNode(node)) {
    return nullableTypeNode(node.type, checker, active);
  }
  if (ts.isTupleTypeNode(node)) {
    return node.elements.some((element) => {
      if (ts.isNamedTupleMember(element)) {
        return (
          Boolean(element.questionToken) ||
          nullableTypeNode(element.type, checker, active)
        );
      }
      return ts.isOptionalTypeNode(element)
        ? true
        : nullableTypeNode(element, checker, active);
    });
  }
  if (!ts.isTypeReferenceNode(node)) return false;
  if (
    ts.isIdentifier(node.typeName) &&
    (node.typeName.text === "Array" || node.typeName.text === "ReadonlyArray")
  ) {
    return Boolean(
      node.typeArguments?.some((argument) =>
        nullableTypeNode(argument, checker, active),
      ),
    );
  }
  const symbol = checker.getSymbolAtLocation(node.typeName);
  const resolved =
    symbol && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  if (!resolved || active.has(resolved)) return false;
  const nextActive = new Set(active).add(resolved);
  return Boolean(
    resolved.declarations?.some(
      (declaration) =>
        ts.isTypeAliasDeclaration(declaration) &&
        nullableTypeNode(declaration.type, checker, nextActive),
    ),
  );
}

function isDefaultLibraryBinding(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  return Boolean(
    symbol?.declarations?.length &&
    symbol.declarations.every(
      (declaration) =>
        declaration.getSourceFile().isDeclarationFile &&
        /(?:^|[/\\])lib\.[^/\\]+\.d\.ts$/.test(
          declaration.getSourceFile().fileName,
        ),
    ),
  );
}
