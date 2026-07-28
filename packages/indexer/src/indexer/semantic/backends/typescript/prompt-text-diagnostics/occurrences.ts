import type { IndexSourceRefFact } from "../../../../patches";
import { isCanonicalPromptTextTag } from "../../../model/prompt-text-identity";
import type { TypeScriptSemanticCompilerView } from "../compiler-view";
import ts from "typescript";

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

/** TypeScript-owned inputs used only while proving exact source-ref identity. */
export interface TypeScriptPromptTextOccurrenceInput {
  readonly sourceFiles: readonly ts.SourceFile[];
  readonly sourceRefs: readonly IndexSourceRefFact[];
  readonly view: TypeScriptSemanticCompilerView;
}

/** One exact normalized source ref joined to its canonical TypeScript tag. */
export interface PromptTextOccurrence {
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
  readonly tag: ts.TaggedTemplateExpression;
}

/**
 * Joins normalized source refs to exact canonical tagged-template occurrences.
 *
 * Missing, duplicate, truncated, range-mismatched, or noncanonical matches are
 * suppressed before TypeScript value classification begins.
 *
 * @param input - TypeScript source files, semantic refs, and identity view.
 * @returns Unique canonical occurrences safe for semantic classification.
 */
export function typeScriptPromptTextOccurrences(
  input: TypeScriptPromptTextOccurrenceInput,
): readonly PromptTextOccurrence[] {
  const tags = input.sourceFiles.flatMap(taggedTemplates);
  const candidates = input.sourceRefs.flatMap((fact) => {
    if (!isPromptTextSourceRef(fact)) return [];
    const matches = tags.filter((tag) => sourceRefMatchesTag(fact, tag));
    if (matches.length !== 1) return [];
    const match = matches[0];
    if (!match) return [];
    const tagExpression = match.tag;
    if (!isCanonicalPromptTextTag(tagExpression, input.view)) return [];
    return [{ fact, tag: match }];
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
): fact is PromptTextOccurrence["fact"] {
  const promptText = fact.ref.metadata?.promptText;
  return (
    fact.definitionId.length > 0 &&
    fact.ref.fidelity === "resolved" &&
    (fact.ref.role === "prompt" || fact.ref.role === "system") &&
    fact.ref.property === fact.ref.role &&
    promptText?.tag === "md" &&
    (promptText.lifecycle === "static" || promptText.lifecycle === "dynamic") &&
    Boolean(fact.ref.snippet && !fact.ref.snippet.truncated)
  );
}

function sourceRefMatchesTag(
  fact: PromptTextOccurrence["fact"],
  tag: ts.TaggedTemplateExpression,
): boolean {
  const snippet = fact.ref.snippet;
  const sourceFile = tag.getSourceFile();
  const start = lineAndColumn(sourceFile, tag.getStart(sourceFile));
  const end = lineAndColumn(sourceFile, tag.end);
  return (
    snippet.range.file === sourceFile.fileName &&
    snippet.range.startLine === start.line &&
    snippet.range.startColumn === start.column &&
    snippet.range.endLine === end.line &&
    snippet.range.endColumn === end.column &&
    snippet.source === tag.getText(sourceFile)
  );
}

function occurrenceKey(occurrence: PromptTextOccurrence): string {
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

function taggedTemplates(
  sourceFile: ts.SourceFile,
): ts.TaggedTemplateExpression[] {
  const tags: ts.TaggedTemplateExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node)) tags.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return tags;
}

/**
 * Converts a TypeScript UTF-16 offset to an exact one-based source point.
 *
 * @param sourceFile - File that owns the compiler offset.
 * @param offset - Zero-based UTF-16 offset into `sourceFile`.
 * @returns One-based UTF-16 line and column coordinates.
 */
export function lineAndColumn(
  sourceFile: ts.SourceFile,
  offset: number,
): { readonly line: number; readonly column: number } {
  const point = sourceFile.getLineAndCharacterOfPosition(offset);
  return { line: point.line + 1, column: point.character + 1 };
}
