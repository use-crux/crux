import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
} from "../candidates";
import { semanticNodeKey, semanticPropertyName } from "../syntax-readers";
import {
  promptTextCallbackExpression,
  promptTextNamedFragment,
} from "./prompt-text-fragments";
import { isCanonicalPromptTextTag } from "./prompt-text-identity";

export interface SemanticPromptTextEdge {
  readonly tag: SemanticAnalyzerNode<SemanticAnalyzerView>;
  readonly edge: SemanticAnalyzerNode<SemanticAnalyzerView>;
  readonly property: "system" | "prompt";
  readonly role: "system" | "prompt";
  readonly lifecycle: "static" | "dynamic";
  readonly symbol?: string;
}

export interface SemanticPromptTextCandidateEdge extends SemanticPromptTextEdge {
  readonly canonical: boolean;
}

export interface SemanticPromptTextPropertySpec {
  readonly property: "system" | "prompt";
  readonly role: "system" | "prompt";
}

/** Collects every canonical prompt-text tag reachable from one definition. */
export function semanticPromptTextEdges(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
  properties: readonly SemanticPromptTextPropertySpec[] = promptTextProperties(
    candidate,
  ),
): readonly SemanticPromptTextEdge[] {
  return semanticPromptTextCandidateEdges(candidate, view, properties).filter(
    (edge) => edge.canonical,
  );
}

/** Collects accepted prompt-text value shapes before canonical tag filtering. */
export function semanticPromptTextCandidateEdges(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
  properties: readonly SemanticPromptTextPropertySpec[] = promptTextProperties(
    candidate,
  ),
): readonly SemanticPromptTextCandidateEdge[] {
  return properties.flatMap((spec) => {
    const expression = definitionPropertyExpression(
      candidate.object,
      spec.property,
      view,
    );
    if (!expression) return [];

    const callback = promptTextCallbackExpression(expression, view);
    if (callback) {
      return view.syntax
        .promptTextReturnExpressions(callback)
        .flatMap((returned) =>
          collectReturnedExpression(returned, returned, spec, view),
        );
    }
    return collectPromptTextValue(
      expression,
      expression,
      spec,
      "static",
      view,
      new Set(),
    );
  });
}

function promptTextProperties(
  candidate: SemanticDefinitionCandidate,
): readonly SemanticPromptTextPropertySpec[] {
  if (candidate.kind === "prompt") {
    return [
      { property: "system", role: "system" },
      { property: "prompt", role: "prompt" },
    ];
  }
  return candidate.kind === "context"
    ? [{ property: "system", role: "system" }]
    : [];
}

function definitionPropertyExpression(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  propertyName: string,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const property = view.syntax
    .objectProperties(object)
    .find((entry) => semanticPropertyName(entry, view.syntax) === propertyName);
  if (!property) return undefined;
  return (
    view.syntax.propertyInitializer(property) ??
    (view.syntax.isKind(property, "methodDeclaration") ? property : undefined)
  );
}

function collectReturnedExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  edge: SemanticAnalyzerNode<SemanticAnalyzerView>,
  spec: SemanticPromptTextPropertySpec,
  view: SemanticAnalyzerView,
): readonly SemanticPromptTextCandidateEdge[] {
  const unwrapped = view.syntax.unwrapExpression(expression);
  const branches = view.syntax.conditionalBranches(unwrapped);
  if (branches) {
    return [
      ...collectReturnedExpression(
        branches.whenTrue,
        branches.whenTrue,
        spec,
        view,
      ),
      ...collectReturnedExpression(
        branches.whenFalse,
        branches.whenFalse,
        spec,
        view,
      ),
    ];
  }
  return collectPromptTextValue(
    unwrapped,
    edge,
    spec,
    "dynamic",
    view,
    new Set(),
  );
}

function collectPromptTextValue(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  edge: SemanticAnalyzerNode<SemanticAnalyzerView>,
  spec: SemanticPromptTextPropertySpec,
  lifecycle: "static" | "dynamic",
  view: SemanticAnalyzerView,
  seen: Set<string>,
): readonly SemanticPromptTextCandidateEdge[] {
  const unwrapped = view.syntax.unwrapExpression(expression);
  if (view.syntax.isKind(unwrapped, "taggedTemplate")) {
    return collectTag(unwrapped, edge, spec, lifecycle, undefined, view, seen);
  }

  const named = promptTextNamedFragment(unwrapped, view);
  return named
    ? collectTag(
        named.tag,
        edge,
        spec,
        lifecycle,
        view.syntax.text(unwrapped),
        view,
        seen,
      )
    : [];
}

function collectTag(
  tag: SemanticAnalyzerNode<SemanticAnalyzerView>,
  edge: SemanticAnalyzerNode<SemanticAnalyzerView>,
  spec: SemanticPromptTextPropertySpec,
  lifecycle: "static" | "dynamic",
  symbol: string | undefined,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): readonly SemanticPromptTextCandidateEdge[] {
  const tagExpression = view.syntax.taggedTemplateTag(tag);
  if (!tagExpression) return [];
  const canonical = isCanonicalPromptTextTag(tagExpression, view);
  const key = semanticNodeKey(tag, view.syntax);
  if (seen.has(key)) return [];
  const nextSeen = new Set(seen);
  nextSeen.add(key);

  const nested = canonical
    ? view.syntax
        .templateExpressions(view.syntax.taggedTemplateBody(tag) ?? tag)
        .flatMap((expression) =>
          collectNestedExpression(expression, spec, lifecycle, view, nextSeen),
        )
    : [];
  return [
    {
      tag,
      edge,
      ...spec,
      lifecycle,
      canonical,
      ...(symbol ? { symbol } : {}),
    },
    ...nested,
  ];
}

function collectNestedExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  spec: SemanticPromptTextPropertySpec,
  lifecycle: "static" | "dynamic",
  view: SemanticAnalyzerView,
  seen: Set<string>,
): readonly SemanticPromptTextCandidateEdge[] {
  const unwrapped = view.syntax.unwrapExpression(expression);
  const direct = collectPromptTextValue(
    unwrapped,
    unwrapped,
    spec,
    lifecycle,
    view,
    seen,
  );
  if (direct.length > 0) return direct;

  return view.syntax.children(unwrapped).flatMap((child) => {
    if (
      view.syntax.isFunctionLike(child) ||
      view.syntax.isKind(child, "classDeclaration")
    ) {
      return [];
    }
    return collectNestedExpression(child, spec, lifecycle, view, seen);
  });
}
