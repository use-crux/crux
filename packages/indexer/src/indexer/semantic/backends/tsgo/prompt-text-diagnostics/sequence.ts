import {
  PROMPT_TEXT_RUNTIME_KINDS,
  type PromptTextRuntimeKind,
} from "@use-crux/core/project-index";
import {
  ElementFlags,
  TypeFlags,
  type Checker,
  type Type,
} from "@typescript/native-preview/unstable/sync";
import type { NativePromptTextValueProof } from "./classification";

/** Conservative native sequence proof before shared normalization. */
export interface NativePromptTextSequenceProof {
  readonly kind: "sequence";
  readonly joinableWithComma: boolean;
  readonly requiredInvalid?: {
    readonly path: readonly number[];
    readonly runtimeKinds: readonly PromptTextRuntimeKind[];
  };
}

/** Classifies built-in native arrays, readonly arrays, and exact tuples. */
export function classifyNativePromptTextSequence(
  type: Type,
  checker: Checker,
  active: ReadonlySet<number>,
  classify: (
    type: Type,
    active: ReadonlySet<number>,
  ) => NativePromptTextValueProof,
): NativePromptTextSequenceProof | undefined {
  if (type.isIntersectionType()) {
    const sequences = type.getTypes().flatMap((member) => {
      const sequence = classifyNativePromptTextSequence(
        member,
        checker,
        active,
        classify,
      );
      return sequence ? [sequence] : [];
    });
    if (sequences.length === 1) return sequences[0];
    if (sequences.length > 1) {
      return {
        ...combineNativePromptTextSequences(sequences),
        joinableWithComma: false,
      };
    }
  }
  if (checker.isTupleType(type) && type.isTypeReference()) {
    const target = type.getTarget();
    const tuple = type.isTupleType()
      ? type
      : target.isTupleType()
        ? target
        : undefined;
    if (!tuple) return undefined;
    const elements = checker.getTypeArguments(type);
    const flags = tuple.elementFlags;
    const required = elements.flatMap((element, index) => {
      const flag = flags[index];
      if (!flag || !(flag & ElementFlags.Required)) return [];
      const proof = classify(element, active);
      if (proof.kind === "invalid") {
        return [{ path: [index], runtimeKinds: proof.runtimeKinds }];
      }
      if (proof.kind === "sequence" && proof.requiredInvalid) {
        return [
          {
            path: [index, ...proof.requiredInvalid.path],
            runtimeKinds: proof.requiredInvalid.runtimeKinds,
          },
        ];
      }
      return [];
    });
    const allRequired =
      elements.length > 0 &&
      flags.every((flag) => Boolean(flag & ElementFlags.Required));
    return {
      kind: "sequence",
      joinableWithComma:
        allRequired && elements.every((element) => joinableElement(element)),
      ...(required[0] ? { requiredInvalid: required[0] } : {}),
    };
  }
  if (!checker.isArrayType(type) || !type.isTypeReference()) return undefined;
  const element = checker.getTypeArguments(type)[0];
  return {
    kind: "sequence",
    joinableWithComma: Boolean(element && joinableElement(element)),
  };
}

/** Combines native sequence union members without inventing tuple paths. */
export function combineNativePromptTextSequences(
  sequences: readonly NativePromptTextSequenceProof[],
): NativePromptTextSequenceProof {
  return {
    kind: "sequence",
    joinableWithComma: sequences.every(
      (sequence) => sequence.joinableWithComma,
    ),
    ...commonRequiredInvalid(sequences),
  };
}

function joinableElement(type: Type): boolean {
  if (type.isUnionType()) {
    const members = type
      .getTypes()
      .filter((member) => !(member.flags & TypeFlags.Never));
    return members.length > 0 && members.every(joinableElement);
  }
  return Boolean(
    type.flags & (TypeFlags.String | TypeFlags.StringLiteral) ||
      (type.isNumberLiteralType() && Number.isFinite(type.value)),
  );
}

function commonRequiredInvalid(
  sequences: readonly NativePromptTextSequenceProof[],
): Pick<NativePromptTextSequenceProof, "requiredInvalid"> {
  const first = sequences[0]?.requiredInvalid;
  if (
    !first ||
    !sequences.every(
      (sequence) =>
        sequence.requiredInvalid &&
        equalPath(sequence.requiredInvalid.path, first.path),
    )
  ) {
    return {};
  }
  return {
    requiredInvalid: {
      path: first.path,
      runtimeKinds: canonicalKinds(
        sequences.flatMap(
          (sequence) => sequence.requiredInvalid?.runtimeKinds ?? [],
        ),
      ),
    },
  };
}

function canonicalKinds(
  kinds: readonly PromptTextRuntimeKind[],
): readonly PromptTextRuntimeKind[] {
  const present = new Set(kinds);
  return PROMPT_TEXT_RUNTIME_KINDS.filter((kind) => present.has(kind));
}

function equalPath(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((part, index) => part === right[index])
  );
}
