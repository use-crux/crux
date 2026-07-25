import type { ProjectSourceRef } from "@use-crux/core/project-index";
import {
  definitionFingerprintFile,
  fingerprint,
  safeId,
} from "../../definitions";
import type {
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
} from "../candidates";
import {
  semanticExactSourceSnippetForNode,
  semanticSourceForNode,
} from "../syntax-readers";
import {
  semanticPromptTextEdges,
  type SemanticPromptTextEdge,
  type SemanticPromptTextPropertySpec,
} from "./prompt-text-reachability";

/** Builds canonical Project Index refs for every proven authored `md` region. */
export function semanticPromptTextSourceRefs(
  root: string,
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
  properties?: readonly SemanticPromptTextPropertySpec[],
): readonly ProjectSourceRef[] {
  const earliestByTag = new Map<string, SemanticPromptTextEdge>();
  for (const edge of semanticPromptTextEdges(candidate, view, properties)) {
    const key = promptTextDedupKey(candidate.definitionId, edge, view);
    const existing = earliestByTag.get(key);
    if (!existing || compareEdge(edge, existing, view) < 0) {
      earliestByTag.set(key, edge);
    }
  }

  return [...earliestByTag.values()]
    .sort((left, right) => compareTag(left, right, view))
    .map((edge) =>
      promptTextSourceRef(root, candidate.definitionId, edge, view),
    );
}

function promptTextSourceRef(
  root: string,
  definitionId: string,
  edge: SemanticPromptTextEdge,
  view: SemanticAnalyzerView,
): ProjectSourceRef {
  const source = semanticSourceForNode(edge.tag, view.syntax);
  const relativeSourceFile = definitionFingerprintFile(root, source.file);
  const sourceFileKey = `${safeId(relativeSourceFile)}-${fingerprint(relativeSourceFile)}`;
  return {
    id: `${definitionId}:source:${edge.role}:${edge.property}:prompt-text:${sourceFileKey}:${source.line}:${source.column}`,
    role: edge.role,
    property: edge.property,
    ...(edge.symbol ? { symbol: edge.symbol } : {}),
    source,
    snippet: semanticExactSourceSnippetForNode(edge.tag, view.syntax),
    fidelity: "resolved",
    metadata: {
      ...(edge.role === "system" ? { fragment: true } : {}),
      promptText: {
        tag: "md",
        language: "markdown",
        lifecycle: edge.lifecycle,
      },
    },
  };
}

function promptTextDedupKey(
  definitionId: string,
  edge: SemanticPromptTextEdge,
  view: SemanticAnalyzerView,
): string {
  const source = semanticSourceForNode(edge.tag, view.syntax);
  return [
    definitionId,
    edge.property,
    edge.lifecycle,
    source.file,
    source.line,
    source.column,
  ].join("\0");
}

function compareEdge(
  left: SemanticPromptTextEdge,
  right: SemanticPromptTextEdge,
  view: SemanticAnalyzerView,
): number {
  const leftFile = view.syntax.sourceFile(left.edge).fileName;
  const rightFile = view.syntax.sourceFile(right.edge).fileName;
  return (
    leftFile.localeCompare(rightFile) ||
    left.edge.pos - right.edge.pos ||
    left.edge.end - right.edge.end
  );
}

function compareTag(
  left: SemanticPromptTextEdge,
  right: SemanticPromptTextEdge,
  view: SemanticAnalyzerView,
): number {
  const leftFile = view.syntax.sourceFile(left.tag).fileName;
  const rightFile = view.syntax.sourceFile(right.tag).fileName;
  return (
    leftFile.localeCompare(rightFile) ||
    left.tag.pos - right.tag.pos ||
    left.tag.end - right.tag.end
  );
}
