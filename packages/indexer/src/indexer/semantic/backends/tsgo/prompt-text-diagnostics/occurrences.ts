import type { IndexSourceRefFact } from "../../../../patches";
import { isCanonicalPromptTextTag } from "../../../model/prompt-text-identity";
import {
  isTaggedTemplateExpression,
  type SourceFile,
  type TaggedTemplateExpression,
} from "@typescript/native-preview/unstable/ast";
import type { TsgoSemanticCompilerView } from "../compiler-view";
import { nativeNodeStart, nativeNodeText } from "../source";

type SourceRef = IndexSourceRefFact["ref"];
type SourceRefMetadata = NonNullable<SourceRef["metadata"]>;
type PromptTextMetadata = NonNullable<SourceRefMetadata["promptText"]>;

type PromptTextOwnerRef =
  | (SourceRef & {
      readonly role: "prompt";
      readonly property: "prompt";
    })
  | (SourceRef & {
      readonly role: "system";
      readonly property: "system";
    });

/** One exact native source ref joined to its canonical tagged template. */
export interface NativePromptTextOccurrence {
  readonly fact: IndexSourceRefFact & {
    readonly ref: PromptTextOwnerRef & {
      readonly snippet: NonNullable<SourceRef["snippet"]>;
      readonly metadata: SourceRefMetadata & {
        readonly promptText: PromptTextMetadata & {
          readonly tag: "md";
          readonly lifecycle: "static" | "dynamic";
        };
      };
    };
  };
  readonly tag: TaggedTemplateExpression;
}

/**
 * Joins normalized source refs to exact native tagged-template occurrences.
 *
 * @param sourceFiles - Native files selected for this semantic analysis.
 * @param sourceRefs - Shared analyzer refs to validate.
 * @param view - Native canonical package/export identity view.
 * @returns Unique exact occurrences; ambiguity and incomplete refs suppress.
 */
export function nativePromptTextOccurrences(
  sourceFiles: readonly SourceFile[],
  sourceRefs: readonly IndexSourceRefFact[],
  view: TsgoSemanticCompilerView,
): readonly NativePromptTextOccurrence[] {
  const tags = sourceFiles.flatMap(taggedTemplates);
  const candidates = sourceRefs.flatMap((fact) => {
    if (!isPromptTextSourceRef(fact)) return [];
    const matches = tags.filter((tag) => sourceRefMatchesTag(fact, tag));
    if (matches.length !== 1) return [];
    const tag = matches[0];
    if (!tag || !isCanonicalPromptTextTag(tag.tag, view)) return [];
    return [{ fact, tag }];
  });
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = occurrenceKey(candidate);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return candidates.filter(
    (candidate) => counts.get(occurrenceKey(candidate)) === 1,
  );
}

function isPromptTextSourceRef(
  fact: IndexSourceRefFact,
): fact is NativePromptTextOccurrence["fact"] {
  const promptText = fact.ref.metadata?.promptText;
  return (
    fact.definitionId.length > 0 &&
    fact.ref.fidelity === "resolved" &&
    (fact.ref.role === "prompt" || fact.ref.role === "system") &&
    fact.ref.property === fact.ref.role &&
    promptText?.tag === "md" &&
    (promptText.lifecycle === "static" ||
      promptText.lifecycle === "dynamic") &&
    Boolean(fact.ref.snippet && !fact.ref.snippet.truncated)
  );
}

function sourceRefMatchesTag(
  fact: NativePromptTextOccurrence["fact"],
  tag: TaggedTemplateExpression,
): boolean {
  const sourceFile = tag.getSourceFile();
  const snippet = fact.ref.snippet;
  const start = lineAndColumn(sourceFile, nativeNodeStart(sourceFile, tag));
  const end = lineAndColumn(sourceFile, tag.end);
  return (
    snippet.range.file === sourceFile.fileName &&
    snippet.range.startLine === start.line &&
    snippet.range.startColumn === start.column &&
    snippet.range.endLine === end.line &&
    snippet.range.endColumn === end.column &&
    snippet.source === nativeNodeText(sourceFile, tag)
  );
}

function occurrenceKey(occurrence: NativePromptTextOccurrence): string {
  return [
    occurrence.fact.definitionId,
    occurrence.fact.ref.role,
    occurrence.fact.ref.property,
    occurrence.fact.ref.metadata.promptText.lifecycle,
    occurrence.tag.getSourceFile().fileName,
    occurrence.tag.pos,
    occurrence.tag.end,
  ].join("\0");
}

function taggedTemplates(sourceFile: SourceFile): TaggedTemplateExpression[] {
  const tags: TaggedTemplateExpression[] = [];
  const visit = (node: import("@typescript/native-preview/unstable/ast").Node) => {
    if (isTaggedTemplateExpression(node)) tags.push(node);
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return tags;
}

/** Converts a native UTF-16 offset to exact one-based coordinates. */
export function lineAndColumn(
  sourceFile: SourceFile,
  offset: number,
): { readonly line: number; readonly column: number } {
  const point = sourceFile.getLineAndCharacterOfPosition(offset);
  return { line: point.line + 1, column: point.character + 1 };
}
