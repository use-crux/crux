import {
  PROMPT_TEXT_RUNTIME_KINDS,
  type PromptTextRuntimeKind,
} from "@use-crux/core/project-index";
import ts from "typescript";
import type { PromptTextValueProof } from "./classification";

/** Conservative sequence shape proven from TypeScript-owned type evidence. */
export interface PromptTextSequenceProof {
  readonly kind: "sequence";
  readonly joinableWithComma: boolean;
  readonly requiredInvalid?: {
    readonly path: readonly number[];
    readonly runtimeKinds: readonly PromptTextRuntimeKind[];
  };
}

/**
 * Classifies built-in mutable/readonly arrays and exact tuple shapes.
 *
 * @param type - TypeScript type being tested for built-in sequence identity.
 * @param checker - Backend-private checker that owns `type`.
 * @param active - Types on the current recursive proof path.
 * @param classify - Recursive scalar/sequence proof callback.
 * @returns Exact sequence evidence, or `undefined` for non-sequences.
 */
export function classifyPromptTextSequence(
  type: ts.Type,
  checker: ts.TypeChecker,
  active: Set<ts.Type>,
  classify: (type: ts.Type, active: Set<ts.Type>) => PromptTextValueProof,
): PromptTextSequenceProof | undefined {
  if (type.isIntersection()) {
    const sequences = type.types.flatMap((member) => {
      const sequence = classifyPromptTextSequence(
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
        ...combinePromptTextSequences(sequences),
        joinableWithComma: false,
      };
    }
  }
  if (checker.isTupleType(type)) {
    const reference = type as ts.TupleTypeReference;
    const elements = checker.getTypeArguments(reference);
    const flags = reference.target.elementFlags;
    const required = elements.flatMap((element, index) => {
      const flag = flags[index];
      if (!flag || !(flag & ts.ElementFlags.Required)) return [];
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
      flags.every((flag) => Boolean(flag & ts.ElementFlags.Required));
    return {
      kind: "sequence",
      joinableWithComma:
        allRequired && elements.every((element) => joinableElement(element)),
      ...(required[0] ? { requiredInvalid: required[0] } : {}),
    };
  }
  if (!isArrayType(type, checker)) return undefined;
  const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  return {
    kind: "sequence",
    joinableWithComma: Boolean(element && joinableElement(element)),
  };
}

/**
 * Combines sequence members of a union without inventing a tuple path.
 *
 * @param sequences - Inhabited sequence proofs from every union member.
 * @returns Evidence shared by all possible sequence members.
 */
export function combinePromptTextSequences(
  sequences: readonly PromptTextSequenceProof[],
): PromptTextSequenceProof {
  return {
    kind: "sequence",
    joinableWithComma: sequences.every(
      (sequence) => sequence.joinableWithComma,
    ),
    ...commonRequiredInvalid(sequences),
  };
}

function joinableElement(type: ts.Type): boolean {
  if (type.isUnion()) {
    const members = type.types.filter(
      (member) => !(member.flags & ts.TypeFlags.Never),
    );
    return members.length > 0 && members.every(joinableElement);
  }
  return Boolean(
    type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral) ||
    (type.flags & ts.TypeFlags.NumberLiteral &&
      Number.isFinite((type as ts.NumberLiteralType).value)),
  );
}

function commonRequiredInvalid(
  sequences: readonly PromptTextSequenceProof[],
): Pick<PromptTextSequenceProof, "requiredInvalid"> {
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

function isArrayType(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (checker.isArrayType(type)) return true;
  const symbol = type.getSymbol();
  return (
    Boolean(type.flags & ts.TypeFlags.Object) &&
    (symbol?.name === "Array" || symbol?.name === "ReadonlyArray") &&
    Boolean(
      symbol.declarations?.length &&
      symbol.declarations.every((declaration) =>
        isDefaultLibraryDeclaration(declaration),
      ),
    )
  );
}

function isDefaultLibraryDeclaration(declaration: ts.Declaration): boolean {
  const sourceFile = declaration.getSourceFile();
  return (
    sourceFile.isDeclarationFile &&
    /(?:^|[/\\])lib\.[^/\\]+\.d\.ts$/.test(sourceFile.fileName)
  );
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
