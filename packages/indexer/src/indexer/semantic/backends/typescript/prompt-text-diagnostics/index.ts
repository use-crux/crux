import type { IndexSourceRefFact } from "../../../../patches";
import type { PromptTextDiagnosticConclusion } from "../../../evidence/prompt-text-diagnostics";
import type { TypeScriptSemanticCompilerView } from "../compiler-view";
import { canonicalUndefinedJsonCall } from "./json";
import ts from "typescript";
import { classifyPromptTextValue } from "./classification";
import { isInlineInterpolation } from "./syntax";
import type { PromptTextRuntimeKind } from "@use-crux/core/project-index";
import {
  lineAndColumn,
  typeScriptPromptTextOccurrences,
  type PromptTextOccurrence,
} from "./occurrences";

/** TypeScript-owned inputs retained inside the JavaScript semantic backend. */
export interface TypeScriptPromptTextDiagnosticInput {
  readonly checker: ts.TypeChecker;
  readonly sourceFiles: readonly ts.SourceFile[];
  readonly sourceRefs: readonly IndexSourceRefFact[];
  readonly view: TypeScriptSemanticCompilerView;
}

/**
 * Classifies PromptText construction failures with private TypeScript objects.
 *
 * Only normalized conclusions leave this backend. Ambiguous source-ref joins,
 * incomplete snippets, noncanonical tags, and missing coordinates fail closed.
 *
 * @param input - Compiler state and normalized source refs from one analysis.
 * @returns Compiler-free conclusions in deterministic authored source order.
 */
export function typeScriptPromptTextDiagnosticConclusions(
  input: TypeScriptPromptTextDiagnosticInput,
): readonly PromptTextDiagnosticConclusion[] {
  return typeScriptPromptTextOccurrences(input).flatMap(({ fact, tag }) => {
    const promptTextType = canonicalPromptTextType(tag, input.checker);
    if (!promptTextType) return [];
    return templateExpressions(tag.template).flatMap((expression, index) => {
      const call = canonicalUndefinedJsonCall(
        expression,
        input.checker,
        input.view,
      );
      if (call) {
        return [
          conclusionBase(fact, index, sourcePoint(call, tag.getSourceFile()), {
            kind: "json-serialization",
            reason: "undefined-result",
          }),
        ];
      }
      const proof = classifyPromptTextValue({
        checker: input.checker,
        expression,
        promptTextType,
      });
      if (proof.kind === "invalid") {
        return [
          invalidConclusion(
            fact,
            index,
            sourcePoint(expression, tag.getSourceFile()),
            proof.runtimeKinds,
            {
              ...(proof.mdJsonApplicable ? { mdJsonApplicable: true } : {}),
            },
          ),
        ];
      }
      if (proof.kind !== "sequence") return [];
      if (proof.requiredInvalid) {
        return [
          invalidConclusion(
            fact,
            index,
            sourcePoint(expression, tag.getSourceFile()),
            proof.requiredInvalid.runtimeKinds,
            { path: proof.requiredInvalid.path },
          ),
        ];
      }
      if (!isInlineInterpolation(tag.template, index)) return [];
      return [
        conclusionBase(
          fact,
          index,
          sourcePoint(expression, tag.getSourceFile()),
          {
            kind: "inline-sequence",
            ...(proof.joinableWithComma ? { joinableWithComma: true } : {}),
          },
        ),
      ];
    });
  });
}

function invalidConclusion(
  fact: PromptTextOccurrence["fact"],
  index: number,
  source: {
    readonly file: string;
    readonly line: number;
    readonly column: number;
  },
  runtimeKinds: readonly PromptTextRuntimeKind[],
  options: {
    readonly path?: readonly number[];
    readonly mdJsonApplicable?: true;
  } = {},
): Extract<
  PromptTextDiagnosticConclusion,
  { readonly cause: { readonly kind: "invalid-interpolation" } }
> {
  return {
    kind: "prompt-text-diagnostic",
    definitionId: fact.definitionId,
    sourceRefId: fact.ref.id,
    owner: ownerForFact(fact),
    proof: "semantic-exact",
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
  fact: PromptTextOccurrence["fact"],
  index: number,
  source: {
    readonly file: string;
    readonly line: number;
    readonly column: number;
  },
  cause: PromptTextDiagnosticConclusion["cause"],
): PromptTextDiagnosticConclusion {
  const base = {
    kind: "prompt-text-diagnostic" as const,
    definitionId: fact.definitionId,
    sourceRefId: fact.ref.id,
    owner: ownerForFact(fact),
    proof: "semantic-exact" as const,
    interpolation: { index, source },
  };
  switch (cause.kind) {
    case "invalid-interpolation":
      return {
        ...base,
        cause,
      };
    case "inline-sequence":
      return {
        ...base,
        cause,
      };
    case "json-serialization":
      return {
        ...base,
        cause,
      };
  }
}

function canonicalPromptTextType(
  tag: ts.TaggedTemplateExpression,
  checker: ts.TypeChecker,
): ts.Type | undefined {
  const signatures = checker.getTypeAtLocation(tag.tag).getCallSignatures();
  if (signatures.length !== 1) return undefined;
  const signature = signatures[0];
  return signature?.getReturnType();
}

function templateExpressions(
  template: ts.TemplateLiteral,
): readonly ts.Expression[] {
  return ts.isTemplateExpression(template)
    ? template.templateSpans.map((span) => span.expression)
    : [];
}

function sourcePoint(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): { readonly file: string; readonly line: number; readonly column: number } {
  const point = lineAndColumn(sourceFile, expression.getStart(sourceFile));
  return { file: sourceFile.fileName, ...point };
}

function ownerForFact(
  fact: PromptTextOccurrence["fact"],
): PromptTextDiagnosticConclusion["owner"] {
  const lifecycle = fact.ref.metadata.promptText.lifecycle;
  return fact.ref.role === "prompt"
    ? { role: "prompt", property: "prompt", lifecycle }
    : { role: "system", property: "system", lifecycle };
}
