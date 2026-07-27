import type {
  ProjectSourceRef,
  PromptTextFragmentJoinEvidence,
  SourceRange,
} from "@use-crux/core/project-index";
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
  semanticNodeKey,
  semanticSourceForNode,
} from "../syntax-readers";
import {
  semanticPromptTextEdges,
  type SemanticPromptTextEdge,
  type SemanticPromptTextPropertySpec,
} from "./prompt-text-reachability";
import { suppressCyclicPromptTextJoins } from "./prompt-text-join-cycles";

/** Builds canonical Project Index refs for every proven authored `md` region. */
export function semanticPromptTextSourceRefs(
  root: string,
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
  properties?: readonly SemanticPromptTextPropertySpec[],
): readonly ProjectSourceRef[] {
  const edges = semanticPromptTextEdges(candidate, view, properties);
  const earliestByTag = new Map<string, SemanticPromptTextEdge>();
  for (const edge of edges) {
    const key = promptTextDedupKey(candidate.definitionId, edge, view);
    const existing = earliestByTag.get(key);
    if (!existing || compareEdge(edge, existing, view) < 0) {
      earliestByTag.set(key, edge);
    }
  }

  const retainedEdges = [...earliestByTag.values()].sort((left, right) =>
    compareTag(left, right, view),
  );
  const refs = retainedEdges.map((edge) =>
    promptTextSourceRef(root, candidate.definitionId, edge, view),
  );
  const refsByTag = new Map(
    retainedEdges.map((edge, index) => [
      promptTextRefKey(edge, view),
      refs[index]!,
    ]),
  );
  const joinsByOwner = promptTextFragmentJoins(edges, refsByTag, view);
  return refs.map((ref) => {
    const joins = joinsByOwner.get(ref.id);
    if (!joins || joins.length === 0) return ref;
    return {
      ...ref,
      metadata: {
        ...ref.metadata,
        promptText: {
          ...ref.metadata!.promptText!,
          fragmentJoins: joins,
        },
      },
    };
  });
}

function promptTextFragmentJoins(
  edges: readonly SemanticPromptTextEdge[],
  refsByTag: ReadonlyMap<string, ProjectSourceRef>,
  view: SemanticAnalyzerView,
): ReadonlyMap<string, readonly PromptTextFragmentJoinEvidence[]> {
  const candidates = new Map<
    string,
    {
      readonly ownerId: string;
      readonly join: PromptTextFragmentJoinEvidence;
    }[]
  >();
  for (const edge of edges) {
    const occurrence = edge.fragmentJoin;
    if (!occurrence) continue;
    const owner = refsByTag.get(
      promptTextRefKey({ ...edge, tag: occurrence.ownerTag }, view),
    );
    const target = refsByTag.get(promptTextRefKey(edge, view));
    if (
      !owner?.snippet ||
      owner.snippet.truncated ||
      !target?.snippet ||
      target.snippet.truncated
    ) {
      continue;
    }
    const expression = semanticExactSourceSnippetForNode(
      occurrence.expression,
      view.syntax,
    );
    if (expression.truncated) continue;
    const join: PromptTextFragmentJoinEvidence = {
      kind: "named-fragment",
      ownerSourceRefId: owner.id,
      ownerTemplateRange: owner.snippet.range,
      interpolationIndex: occurrence.interpolationIndex,
      expressionRange: expression.range,
      targetSourceRefId: target.id,
      targetTemplateRange: target.snippet.range,
      proof: "semantic-exact",
    };
    const key = fragmentJoinKey(join);
    const values = candidates.get(key) ?? [];
    values.push({ ownerId: owner.id, join });
    candidates.set(key, values);
  }

  const unique = [...candidates.values()].flatMap((values) =>
    values.length === 1 ? values : [],
  );
  const byOwner = new Map<string, PromptTextFragmentJoinEvidence[]>();
  for (const { ownerId, join } of suppressCyclicPromptTextJoins(unique)) {
    const joins = byOwner.get(ownerId) ?? [];
    joins.push(join);
    byOwner.set(ownerId, joins);
  }
  for (const joins of byOwner.values()) joins.sort(compareFragmentJoin);
  return byOwner;
}

function promptTextRefKey(
  edge: Pick<SemanticPromptTextEdge, "tag" | "role" | "property" | "lifecycle">,
  view: SemanticAnalyzerView,
): string {
  return [
    semanticNodeKey(edge.tag, view.syntax),
    edge.role,
    edge.property,
    edge.lifecycle,
  ].join("\0");
}

function fragmentJoinKey(join: PromptTextFragmentJoinEvidence): string {
  return [
    join.ownerSourceRefId,
    join.interpolationIndex,
    rangeKey(join.expressionRange),
  ].join("\0");
}

function rangeKey(range: SourceRange): string {
  return [
    range.file,
    range.startLine,
    range.startColumn ?? "",
    range.endLine ?? "",
    range.endColumn ?? "",
  ].join(":");
}

function compareFragmentJoin(
  left: PromptTextFragmentJoinEvidence,
  right: PromptTextFragmentJoinEvidence,
): number {
  return (
    left.interpolationIndex - right.interpolationIndex ||
    rangeKey(left.expressionRange).localeCompare(
      rangeKey(right.expressionRange),
    ) ||
    left.targetSourceRefId.localeCompare(right.targetSourceRefId)
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
