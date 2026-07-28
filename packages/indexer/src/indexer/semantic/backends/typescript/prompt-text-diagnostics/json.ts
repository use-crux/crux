import ts from "typescript";
import type { TypeScriptSemanticCompilerView } from "../compiler-view";
import { canonicalPromptTextIdentity } from "../../../model/prompt-text-identity";

/**
 * Returns a canonical `md.json()` call whose argument always stringifies to
 * `undefined`, or `undefined` when syntax, identity, or type proof is weaker.
 *
 * @param expression - Complete interpolation expression.
 * @param checker - Backend-private checker used for undefined-result proof.
 * @param view - Canonical package/export identity resolver.
 * @returns The exact call node, or `undefined` when any proof is incomplete.
 */
export function canonicalUndefinedJsonCall(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  view: TypeScriptSemanticCompilerView,
): ts.CallExpression | undefined {
  const unwrapped = unwrapTransparentExpression(expression);
  if (!ts.isCallExpression(unwrapped) || unwrapped.questionDotToken) {
    return undefined;
  }
  const argument = unwrapped.arguments[0];
  if (
    unwrapped.arguments.length !== 1 ||
    !argument ||
    ts.isSpreadElement(argument)
  ) {
    return undefined;
  }
  const callee = unwrapTransparentExpression(unwrapped.expression);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.questionDotToken ||
    callee.name.text !== "json"
  ) {
    return undefined;
  }
  const receiver = unwrapTransparentExpression(callee.expression);
  const identity = view.canonicalExportIdentity(
    receiver,
    canonicalPromptTextIdentity.module,
    canonicalPromptTextIdentity.export,
  );
  if (
    identity?.module !== canonicalPromptTextIdentity.module ||
    identity.export !== canonicalPromptTextIdentity.export
  ) {
    return undefined;
  }
  return jsonStringifyAlwaysUndefined(argument, checker)
    ? unwrapped
    : undefined;
}

/**
 * Removes only syntax wrappers that cannot change runtime receiver identity.
 *
 * @param expression - Expression wrapped by transparent TypeScript syntax.
 * @returns The first runtime-significant expression.
 */
export function unwrapTransparentExpression(
  expression: ts.Expression,
): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function jsonStringifyAlwaysUndefined(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  const unwrapped = unwrapTransparentExpression(expression);
  if (ts.isVoidExpression(unwrapped)) return true;
  const type = checker.getTypeAtLocation(unwrapped);
  const members = type.isUnion() ? type.types : [type];
  let inhabited = false;

  for (const member of members) {
    if (member.flags & ts.TypeFlags.Never) continue;
    if (
      member.flags &
      (ts.TypeFlags.Undefined |
        ts.TypeFlags.ESSymbol |
        ts.TypeFlags.UniqueESSymbol)
    ) {
      inhabited = true;
      continue;
    }
    return false;
  }
  return inhabited;
}
