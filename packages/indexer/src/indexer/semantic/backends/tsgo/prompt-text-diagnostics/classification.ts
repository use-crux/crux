import {
  PROMPT_TEXT_RUNTIME_KINDS,
  type PromptTextRuntimeKind,
} from "@use-crux/core/project-index";
import {
  ObjectFlags,
  SignatureKind,
  TypeFlags,
  type Checker,
  type Type,
} from "@typescript/native-preview/unstable/sync";
import {
  isVoidExpression,
  type Expression,
} from "@typescript/native-preview/unstable/ast";
import type { TsgoSemanticCompilerView } from "../compiler-view";
import {
  isExactNonFiniteNumber,
  isExactTrueExpression,
} from "./syntax";
import { hasExplicitNullableType } from "./nullable";
import {
  classifyNativePromptTextSequence,
  combineNativePromptTextSequences,
  type NativePromptTextSequenceProof,
} from "./sequence";

/** Native-private proof lattice before compiler-free normalization. */
export type NativePromptTextValueProof =
  | { readonly kind: "accepted" }
  | {
      readonly kind: "invalid";
      readonly runtimeKinds: readonly PromptTextRuntimeKind[];
      readonly mdJsonApplicable?: true;
    }
  | NativePromptTextSequenceProof
  | { readonly kind: "uncertain" }
  | { readonly kind: "uninhabited" };

/** Conservatively classifies one native interpolation without evaluation. */
export function classifyNativePromptTextValue(input: {
  readonly checker: Checker;
  readonly expression: Expression;
  readonly promptTextType: Type;
  readonly view: TsgoSemanticCompilerView;
}): NativePromptTextValueProof {
  if (isVoidExpression(input.expression)) {
    return { kind: "accepted" };
  }
  if (isExactNonFiniteNumber(input.expression, input.view)) {
    return {
      kind: "invalid",
      runtimeKinds: ["non-finite-number"],
      mdJsonApplicable: true,
    };
  }
  const type = input.checker.getTypeAtLocation(input.expression);
  if (!type || type.isErrorType()) return { kind: "uncertain" };
  const proof = classifyType(
    type,
    input.checker,
    input.promptTextType,
    new Set(),
  );
  if (
    proof.kind === "sequence" &&
    proof.joinableWithComma &&
    hasExplicitNullableType(input.expression, input.checker, input.view)
  ) {
    return { ...proof, joinableWithComma: false };
  }
  if (
    proof.kind === "invalid" &&
    proof.runtimeKinds.length === 1 &&
    proof.runtimeKinds[0] === "boolean" &&
    isExactTrueExpression(input.expression, input.view)
  ) {
    return { ...proof, mdJsonApplicable: true };
  }
  return proof;
}

function classifyType(
  type: Type,
  checker: Checker,
  promptTextType: Type,
  active: ReadonlySet<number>,
): NativePromptTextValueProof {
  if (type.flags & TypeFlags.Never) return { kind: "uninhabited" };
  if (type.flags & (TypeFlags.Any | TypeFlags.Unknown)) {
    return { kind: "uncertain" };
  }
  if (type.flags & TypeFlags.TypeParameter) {
    const constraint = checker.getBaseConstraintOfType(type);
    const sequence =
      constraint &&
      classifyNativePromptTextSequence(
        constraint,
        checker,
        new Set(active).add(type.id),
        (nested, nestedActive) =>
          classifyType(nested, checker, promptTextType, nestedActive),
      );
    return sequence
      ? { kind: "sequence", joinableWithComma: false }
      : { kind: "uncertain" };
  }
  if (active.has(type.id)) return { kind: "uncertain" };
  const nextActive = new Set(active).add(type.id);

  if (type.isUnionType()) {
    return classifyUnion(type.getTypes(), checker, promptTextType, nextActive);
  }
  if (
    type.isIntersectionType() &&
    type.getTypes().some((member) => member.flags & TypeFlags.TypeParameter)
  ) {
    return { kind: "uncertain" };
  }
  if (checker.isTypeAssignableTo(type, promptTextType)) {
    return { kind: "accepted" };
  }
  if (isStringLike(type, checker)) return { kind: "accepted" };
  if (type.isNumberLiteralType()) {
    return Number.isFinite(type.value)
      ? { kind: "accepted" }
      : { kind: "uncertain" };
  }
  if (isNumberLike(type, checker)) return { kind: "uncertain" };
  if (type.isBooleanLiteralType()) {
    return type.value === false ? { kind: "accepted" } : invalid("boolean");
  }
  if (type.flags & TypeFlags.Boolean) return { kind: "uncertain" };
  if (type.flags & (TypeFlags.Null | TypeFlags.Undefined)) {
    return { kind: "accepted" };
  }
  if (type.flags & TypeFlags.Void) return { kind: "uncertain" };
  if (type.flags & (TypeFlags.BigInt | TypeFlags.BigIntLiteral)) {
    return invalid("bigint");
  }
  if (type.flags & (TypeFlags.ESSymbol | TypeFlags.UniqueESSymbol)) {
    return invalid("symbol");
  }

  const sequence = classifyNativePromptTextSequence(
    type,
    checker,
    nextActive,
    (nested, nestedActive) =>
      classifyType(nested, checker, promptTextType, nestedActive),
  );
  if (sequence) return sequence;
  if (
    checker.getSignaturesOfType(type, SignatureKind.Call).length > 0 ||
    checker.getSignaturesOfType(type, SignatureKind.Construct).length > 0
  ) {
    return invalid("function");
  }
  if (type.flags & TypeFlags.NonPrimitive || isBroadEmptyObject(type, checker)) {
    return { kind: "uncertain" };
  }
  if (type.isIntersectionType()) {
    return checker.getPropertiesOfType(type).length > 0
      ? invalid("object")
      : { kind: "uncertain" };
  }
  if (type.flags & TypeFlags.Enum) return { kind: "uncertain" };
  if (type.isObjectType()) {
    return checker.getPropertiesOfType(type).length > 0 ||
      Boolean(type.objectFlags & ObjectFlags.ClassOrInterface)
      ? invalid("object")
      : { kind: "uncertain" };
  }
  return { kind: "uncertain" };
}

function classifyUnion(
  members: readonly Type[],
  checker: Checker,
  promptTextType: Type,
  active: ReadonlySet<number>,
): NativePromptTextValueProof {
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
    return combineNativePromptTextSequences(
      proofs.filter(
        (
          proof,
        ): proof is Extract<
          NativePromptTextValueProof,
          { kind: "sequence" }
        > => proof.kind === "sequence",
      ),
    );
  }
  if (proofs.every((proof) => proof.kind === "accepted")) {
    return { kind: "accepted" };
  }
  return { kind: "uncertain" };
}

function isStringLike(type: Type, checker: Checker): boolean {
  return (
    Boolean(type.flags & (TypeFlags.String | TypeFlags.StringLiteral)) ||
    (type.isIntersectionType() &&
      checker.isTypeAssignableTo(type, checker.getStringType()))
  );
}

function isNumberLike(type: Type, checker: Checker): boolean {
  return (
    Boolean(type.flags & TypeFlags.Number) ||
    (type.isIntersectionType() &&
      checker.isTypeAssignableTo(type, checker.getNumberType()))
  );
}

function isBroadEmptyObject(type: Type, checker: Checker): boolean {
  return (
    type.isObjectType() &&
    !(type.objectFlags & ObjectFlags.ClassOrInterface) &&
    checker.getPropertiesOfType(type).length === 0 &&
    checker.getSignaturesOfType(type, SignatureKind.Call).length === 0 &&
    checker.getSignaturesOfType(type, SignatureKind.Construct).length === 0
  );
}

function invalid(
  runtimeKind: PromptTextRuntimeKind,
): Extract<NativePromptTextValueProof, { kind: "invalid" }> {
  return { kind: "invalid", runtimeKinds: [runtimeKind] };
}

function canonicalKinds(
  kinds: readonly PromptTextRuntimeKind[],
): readonly PromptTextRuntimeKind[] {
  const present = new Set(kinds);
  return PROMPT_TEXT_RUNTIME_KINDS.filter((kind) => present.has(kind));
}
