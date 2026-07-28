import {
  isAsExpression,
  isCallExpression,
  isNonNullExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isSatisfiesExpression,
  isSpreadElement,
  isTypeAssertion,
  isVoidExpression,
  type CallExpression,
  type Expression,
} from "@typescript/native-preview/unstable/ast";
import {
  TypeFlags,
  type Checker,
} from "@typescript/native-preview/unstable/sync";
import { canonicalPromptTextIdentity } from "../../../model/prompt-text-identity";
import type { TsgoSemanticCompilerView } from "../compiler-view";
import { nativeNodeList } from "../source";

/**
 * Returns a canonical native `md.json()` call proven to stringify undefined.
 *
 * @param expression - Complete interpolation expression.
 * @param checker - Native checker used only inside this backend.
 * @param view - Canonical package/export identity resolver.
 * @returns The exact call or `undefined` when any proof is incomplete.
 */
export function canonicalUndefinedJsonCall(
  expression: Expression,
  checker: Checker,
  view: TsgoSemanticCompilerView,
): CallExpression | undefined {
  const unwrapped = unwrapTransparentExpression(expression);
  if (!isCallExpression(unwrapped) || unwrapped.questionDotToken) {
    return undefined;
  }
  const args = nativeNodeList(unwrapped.arguments);
  const argument = args[0];
  if (args.length !== 1 || !argument || isSpreadElement(argument)) {
    return undefined;
  }
  const callee = unwrapTransparentExpression(unwrapped.expression);
  if (
    !isPropertyAccessExpression(callee) ||
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

/** Removes only runtime-transparent native TypeScript wrappers. */
export function unwrapTransparentExpression(
  expression: Expression,
): Expression {
  let current = expression;
  while (
    isParenthesizedExpression(current) ||
    isAsExpression(current) ||
    isSatisfiesExpression(current) ||
    isTypeAssertion(current) ||
    isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function jsonStringifyAlwaysUndefined(
  expression: Expression,
  checker: Checker,
): boolean {
  const unwrapped = unwrapTransparentExpression(expression);
  if (isVoidExpression(unwrapped)) return true;
  const type = checker.getTypeAtLocation(unwrapped);
  if (!type || type.isErrorType()) return false;
  const members = type.isUnionType() ? type.getTypes() : [type];
  let inhabited = false;

  for (const member of members) {
    if (member.flags & TypeFlags.Never) continue;
    if (
      member.flags &
      (TypeFlags.Undefined | TypeFlags.ESSymbol | TypeFlags.UniqueESSymbol)
    ) {
      inhabited = true;
      continue;
    }
    return false;
  }
  return inhabited;
}
