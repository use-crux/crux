import type { IndexSourceRefFact } from "../../../../patches";
import type { PromptTextDiagnosticConclusion } from "../../../evidence/prompt-text-diagnostics";
import {
  SignatureKind,
  type Checker,
  type Type,
} from "@typescript/native-preview/unstable/sync";
import {
  isTemplateExpression,
  type Expression,
  type SourceFile,
} from "@typescript/native-preview/unstable/ast";
import type { TsgoSemanticCompilerView } from "../compiler-view";
import { nativeNodeList, nativeNodeStart } from "../source";
import { classifyNativePromptTextValue } from "./classification";
import { canonicalUndefinedJsonCall } from "./json";
import {
  lineAndColumn,
  nativePromptTextOccurrences,
  type NativePromptTextOccurrence,
} from "./occurrences";
import { isInlineInterpolation } from "./syntax";
import type { PromptTextRuntimeKind } from "@use-crux/core/project-index";

/** Native compiler state retained inside the TypeScript-Go backend. */
export interface NativePromptTextDiagnosticInput {
  readonly checker: Checker;
  readonly sourceFiles: readonly SourceFile[];
  readonly sourceRefs: readonly IndexSourceRefFact[];
  readonly view: TsgoSemanticCompilerView;
}

/**
 * Produces compiler-free PromptText conclusions from native semantic evidence.
 *
 * @param input - Native checker, source files, exact refs, and identity view.
 * @returns Conclusions ready for the one shared projector.
 */
export function nativePromptTextDiagnosticConclusions(
  input: NativePromptTextDiagnosticInput,
): readonly PromptTextDiagnosticConclusion[] {
  return nativePromptTextOccurrences(
    input.sourceFiles,
    input.sourceRefs,
    input.view,
  ).flatMap(({ fact, tag }) => {
    const promptTextType = canonicalPromptTextType(
      tag.tag,
      input.checker,
    );
    if (!promptTextType || !isTemplateExpression(tag.template)) return [];
    return nativeNodeList(tag.template.templateSpans).flatMap((span, index) => {
      const expression = span.expression;
      const call = canonicalUndefinedJsonCall(
        expression,
        input.checker,
        input.view,
      );
      if (call) {
        return [
          conclusionBase(fact, index, sourcePoint(call), {
            kind: "json-serialization",
            reason: "undefined-result",
          }),
        ];
      }
      const proof = classifyNativePromptTextValue({
        checker: input.checker,
        expression,
        promptTextType,
        view: input.view,
      });
      if (proof.kind === "invalid") {
        return [
          invalidConclusion(
            fact,
            index,
            sourcePoint(expression),
            proof.runtimeKinds,
            proof.mdJsonApplicable ? { mdJsonApplicable: true } : {},
          ),
        ];
      }
      if (proof.kind !== "sequence") return [];
      if (proof.requiredInvalid) {
        return [
          invalidConclusion(
            fact,
            index,
            sourcePoint(expression),
            proof.requiredInvalid.runtimeKinds,
            { path: proof.requiredInvalid.path },
          ),
        ];
      }
      if (!isInlineInterpolation(tag.template, index)) return [];
      return [
        conclusionBase(fact, index, sourcePoint(expression), {
          kind: "inline-sequence",
          ...(proof.joinableWithComma ? { joinableWithComma: true } : {}),
        }),
      ];
    });
  });
}

function invalidConclusion(
  fact: NativePromptTextOccurrence["fact"],
  index: number,
  source: PromptTextDiagnosticConclusion["interpolation"]["source"],
  runtimeKinds: readonly PromptTextRuntimeKind[],
  options: {
    readonly path?: readonly number[];
    readonly mdJsonApplicable?: true;
  },
): Extract<
  PromptTextDiagnosticConclusion,
  { readonly cause: { readonly kind: "invalid-interpolation" } }
> {
  return {
    ...conclusionIdentity(fact, index, source),
    interpolation: {
      index,
      source,
      ...(options.path ? { path: options.path } : {}),
    },
    cause: {
      kind: "invalid-interpolation",
      runtimeKinds,
      ...(options.mdJsonApplicable ? { mdJsonApplicable: true } : {}),
    },
  };
}

function conclusionBase(
  fact: NativePromptTextOccurrence["fact"],
  index: number,
  source: PromptTextDiagnosticConclusion["interpolation"]["source"],
  cause: Exclude<
    PromptTextDiagnosticConclusion["cause"],
    { readonly kind: "invalid-interpolation" }
  >,
): PromptTextDiagnosticConclusion {
  const identity = conclusionIdentity(fact, index, source);
  switch (cause.kind) {
    case "inline-sequence":
      return { ...identity, cause };
    case "json-serialization":
      return { ...identity, cause };
  }
}

function conclusionIdentity(
  fact: NativePromptTextOccurrence["fact"],
  index: number,
  source: PromptTextDiagnosticConclusion["interpolation"]["source"],
) {
  const lifecycle = fact.ref.metadata.promptText.lifecycle;
  return {
    kind: "prompt-text-diagnostic" as const,
    definitionId: fact.definitionId,
    sourceRefId: fact.ref.id,
    owner:
      fact.ref.role === "prompt"
        ? ({ role: "prompt", property: "prompt", lifecycle } as const)
        : ({ role: "system", property: "system", lifecycle } as const),
    proof: "semantic-exact" as const,
    interpolation: { index, source },
  };
}

function canonicalPromptTextType(
  tag: import("@typescript/native-preview/unstable/ast").Node,
  checker: Checker,
): Type | undefined {
  const type = checker.getTypeAtLocation(tag);
  if (!type || type.isErrorType()) return undefined;
  const signatures = checker.getSignaturesOfType(type, SignatureKind.Call);
  const signature = signatures.length === 1 ? signatures[0] : undefined;
  return signature ? checker.getReturnTypeOfSignature(signature) : undefined;
}

function sourcePoint(
  expression: Expression,
): PromptTextDiagnosticConclusion["interpolation"]["source"] {
  const sourceFile = expression.getSourceFile();
  return {
    file: sourceFile.fileName,
    ...lineAndColumn(
      sourceFile,
      nativeNodeStart(sourceFile, expression),
    ),
  };
}
