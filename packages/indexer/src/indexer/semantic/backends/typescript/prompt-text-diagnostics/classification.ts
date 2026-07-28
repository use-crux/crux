import {
  PROMPT_TEXT_RUNTIME_KINDS,
  type PromptTextRuntimeKind,
} from "@use-crux/core/project-index";
import ts from "typescript";
import {
  isExactNonFiniteNumber,
  isExactTrueExpression,
  hasExplicitNullableType,
} from "./syntax";
import {
  classifyPromptTextSequence,
  combinePromptTextSequences,
  type PromptTextSequenceProof,
} from "./sequence";

/** Private TypeScript proof lattice before compiler-free normalization. */
export type PromptTextValueProof =
  | { readonly kind: "accepted" }
  | {
      readonly kind: "invalid";
      readonly runtimeKinds: readonly PromptTextRuntimeKind[];
      readonly mdJsonApplicable?: true;
    }
  | PromptTextSequenceProof
  | { readonly kind: "uncertain" }
  | { readonly kind: "uninhabited" };

/** Compiler-owned inputs for classifying one complete interpolation value. */
export interface PromptTextValueClassifierInput {
  readonly checker: ts.TypeChecker;
  readonly expression: ts.Expression;
  readonly promptTextType: ts.Type;
}

/**
 * Conservatively classifies one interpolation without evaluating user code.
 *
 * @param input - Private checker, expression, and canonical PromptText type.
 * @returns The strongest complete proof available, otherwise `uncertain`.
 */
export function classifyPromptTextValue(
  input: PromptTextValueClassifierInput,
): PromptTextValueProof {
  const expression = input.expression;
  if (ts.isVoidExpression(expression)) return { kind: "accepted" };
  if (isExactNonFiniteNumber(expression, input.checker)) {
    return {
      kind: "invalid",
      runtimeKinds: ["non-finite-number"],
      mdJsonApplicable: true,
    };
  }
  const proof = classifyType(
    input.checker.getTypeAtLocation(expression),
    input.checker,
    input.promptTextType,
    new Set(),
  );
  if (
    proof.kind === "sequence" &&
    proof.joinableWithComma &&
    hasExplicitNullableType(expression, input.checker)
  ) {
    return { ...proof, joinableWithComma: false };
  }
  if (
    proof.kind === "invalid" &&
    proof.runtimeKinds.length === 1 &&
    proof.runtimeKinds[0] === "boolean" &&
    isExactTrueExpression(expression, input.checker)
  ) {
    return { ...proof, mdJsonApplicable: true };
  }
  return proof;
}

function classifyType(
  type: ts.Type,
  checker: ts.TypeChecker,
  promptTextType: ts.Type,
  active: Set<ts.Type>,
): PromptTextValueProof {
  if (type.flags & ts.TypeFlags.Never) return { kind: "uninhabited" };
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    return { kind: "uncertain" };
  }
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const constraint = checker.getBaseConstraintOfType(type);
    const sequence =
      constraint &&
      classifyPromptTextSequence(
        constraint,
        checker,
        new Set(active).add(type),
        (nested, nestedActive) =>
          classifyType(nested, checker, promptTextType, nestedActive),
      );
    return sequence
      ? {
          kind: "sequence",
          joinableWithComma: false,
        }
      : { kind: "uncertain" };
  }
  if (active.has(type)) return { kind: "uncertain" };
  const nextActive = new Set(active).add(type);

  if (type.isUnion()) {
    return classifyUnion(type.types, checker, promptTextType, nextActive);
  }
  if (
    type.isIntersection() &&
    type.types.some((member) => member.flags & ts.TypeFlags.TypeParameter)
  ) {
    return { kind: "uncertain" };
  }
  if (isCanonicalPromptText(type, promptTextType, checker)) {
    return { kind: "accepted" };
  }
  if (isStringLike(type, checker)) return { kind: "accepted" };
  if (type.flags & ts.TypeFlags.NumberLiteral) {
    const value = (type as ts.NumberLiteralType).value;
    return Number.isFinite(value)
      ? { kind: "accepted" }
      : { kind: "uncertain" };
  }
  if (isNumberLike(type, checker)) return { kind: "uncertain" };
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return checker.typeToString(type) === "false"
      ? { kind: "accepted" }
      : invalid("boolean");
  }
  if (type.flags & ts.TypeFlags.Boolean) return { kind: "uncertain" };
  if (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) {
    return { kind: "accepted" };
  }
  if (type.flags & ts.TypeFlags.Void) return { kind: "uncertain" };
  if (type.flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) {
    return invalid("bigint");
  }
  if (type.flags & (ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol)) {
    return invalid("symbol");
  }

  const sequence = classifyPromptTextSequence(
    type,
    checker,
    nextActive,
    (nested, nestedActive) =>
      classifyType(nested, checker, promptTextType, nestedActive),
  );
  if (sequence) return sequence;
  if (
    type.getCallSignatures().length > 0 ||
    type.getConstructSignatures().length > 0
  ) {
    return invalid("function");
  }
  if (type.flags & ts.TypeFlags.NonPrimitive || isBroadEmptyObject(type)) {
    return { kind: "uncertain" };
  }
  if (type.isIntersection()) {
    return type.getProperties().length > 0
      ? invalid("object")
      : { kind: "uncertain" };
  }
  if (type.flags & ts.TypeFlags.Enum) return { kind: "uncertain" };
  if (type.flags & ts.TypeFlags.Object) {
    return type.getProperties().length > 0 ||
      Boolean(
        (type.getSymbol()?.flags ?? 0) &
        (ts.SymbolFlags.Class | ts.SymbolFlags.Interface),
      )
      ? invalid("object")
      : { kind: "uncertain" };
  }
  return { kind: "uncertain" };
}

function classifyUnion(
  members: readonly ts.Type[],
  checker: ts.TypeChecker,
  promptTextType: ts.Type,
  active: Set<ts.Type>,
): PromptTextValueProof {
  const proofs = members
    .map((member) => classifyType(member, checker, promptTextType, active))
    .filter((proof) => proof.kind !== "uninhabited");
  if (proofs.length === 0) return { kind: "uninhabited" };
  if (proofs.every((proof) => proof.kind === "invalid")) {
    return {
      kind: "invalid",
      runtimeKinds: canonicalKinds(
        proofs.flatMap((proof) =>
          proof.kind === "invalid" ? proof.runtimeKinds : [],
        ),
      ),
    };
  }
  if (proofs.every((proof) => proof.kind === "sequence")) {
    const sequences = proofs.filter(
      (proof): proof is Extract<PromptTextValueProof, { kind: "sequence" }> =>
        proof.kind === "sequence",
    );
    return combinePromptTextSequences(sequences);
  }
  if (proofs.every((proof) => proof.kind === "accepted")) {
    return { kind: "accepted" };
  }
  return { kind: "uncertain" };
}

function isCanonicalPromptText(
  type: ts.Type,
  promptTextType: ts.Type,
  checker: ts.TypeChecker,
): boolean {
  return checker.isTypeAssignableTo(type, promptTextType);
}

function isStringLike(type: ts.Type, checker: ts.TypeChecker): boolean {
  return (
    Boolean(type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) ||
    (type.isIntersection() &&
      checker.isTypeAssignableTo(type, checker.getStringType()))
  );
}

function isNumberLike(type: ts.Type, checker: ts.TypeChecker): boolean {
  return (
    Boolean(type.flags & ts.TypeFlags.Number) ||
    (type.isIntersection() &&
      checker.isTypeAssignableTo(type, checker.getNumberType()))
  );
}

function isBroadEmptyObject(type: ts.Type): boolean {
  const symbolFlags = type.getSymbol()?.flags ?? 0;
  return (
    Boolean(type.flags & ts.TypeFlags.Object) &&
    !(symbolFlags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)) &&
    type.getProperties().length === 0 &&
    type.getCallSignatures().length === 0 &&
    type.getConstructSignatures().length === 0
  );
}

function invalid(
  runtimeKind: PromptTextRuntimeKind,
): Extract<PromptTextValueProof, { kind: "invalid" }> {
  return { kind: "invalid", runtimeKinds: [runtimeKind] };
}

function canonicalKinds(
  kinds: readonly PromptTextRuntimeKind[],
): readonly PromptTextRuntimeKind[] {
  const present = new Set(kinds);
  return PROMPT_TEXT_RUNTIME_KINDS.filter((kind) => present.has(kind));
}
