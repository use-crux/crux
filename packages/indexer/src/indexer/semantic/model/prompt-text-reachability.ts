import type { PromptTextSourceKind } from "@use-crux/core/project-index";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
} from "../candidates";
import { semanticNodeKey } from "../syntax-readers";
import {
  promptTextPropertyExpression,
  semanticPromptTextProperties,
  type SemanticPromptTextPropertySpec,
} from "./prompt-text/properties";
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
  readonly sourceKind: PromptTextSourceKind;
  readonly symbol?: string;
  readonly fragmentJoin?: {
    readonly ownerTag: SemanticAnalyzerNode<SemanticAnalyzerView>;
    readonly interpolationIndex: number;
    readonly expression: SemanticAnalyzerNode<SemanticAnalyzerView>;
  };
}

export interface SemanticPromptTextCandidateEdge extends SemanticPromptTextEdge {
  readonly canonical: boolean;
}

export { semanticPromptTextProperties };
export type { SemanticPromptTextPropertySpec };

/** Collects every canonical prompt-text tag reachable from one definition. */
export function semanticPromptTextEdges(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
  properties: readonly SemanticPromptTextPropertySpec[] = semanticPromptTextProperties(
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
  properties: readonly SemanticPromptTextPropertySpec[] = semanticPromptTextProperties(
    candidate,
  ),
): readonly SemanticPromptTextCandidateEdge[] {
  return properties.flatMap((spec) => {
    const expression = promptTextPropertyExpression(
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
      "owner",
    );
  });
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
    "owner",
  );
}

function collectPromptTextValue(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  edge: SemanticAnalyzerNode<SemanticAnalyzerView>,
  spec: SemanticPromptTextPropertySpec,
  lifecycle: "static" | "dynamic",
  view: SemanticAnalyzerView,
  seen: Set<string>,
  unnamedSourceKind: Extract<
    PromptTextSourceKind,
    "owner" | "anonymous-fragment"
  >,
  fragmentJoin?: SemanticPromptTextEdge["fragmentJoin"],
): readonly SemanticPromptTextCandidateEdge[] {
  const unwrapped = view.syntax.unwrapExpression(expression);
  if (view.syntax.isKind(unwrapped, "taggedTemplate")) {
    return collectTag(
      unwrapped,
      edge,
      spec,
      lifecycle,
      undefined,
      view,
      seen,
      unnamedSourceKind,
      fragmentJoin,
    );
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
        unnamedSourceKind,
        fragmentJoin,
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
  unnamedSourceKind: Extract<
    PromptTextSourceKind,
    "owner" | "anonymous-fragment"
  >,
  fragmentJoin?: SemanticPromptTextEdge["fragmentJoin"],
): readonly SemanticPromptTextCandidateEdge[] {
  const tagExpression = view.syntax.taggedTemplateTag(tag);
  if (!tagExpression) return [];
  const canonical = isCanonicalPromptTextTag(tagExpression, view);
  const key = semanticNodeKey(tag, view.syntax);
  const sourceKind: PromptTextSourceKind = symbol
    ? "named-fragment"
    : unnamedSourceKind;
  const current: SemanticPromptTextCandidateEdge = {
    tag,
    edge,
    ...spec,
    lifecycle,
    canonical,
    sourceKind,
    ...(symbol ? { symbol } : {}),
    ...(symbol && fragmentJoin ? { fragmentJoin } : {}),
  };
  if (seen.has(key)) return [current];
  const nextSeen = new Set(seen);
  nextSeen.add(key);

  const nested = canonical
    ? view.syntax
        .templateExpressions(view.syntax.taggedTemplateBody(tag) ?? tag)
        .flatMap((expression, interpolationIndex) =>
          collectNestedExpression(
            expression,
            interpolationIndex,
            tag,
            spec,
            lifecycle,
            view,
            nextSeen,
          ),
        )
    : [];
  return [current, ...nested];
}

function collectNestedExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  interpolationIndex: number,
  ownerTag: SemanticAnalyzerNode<SemanticAnalyzerView>,
  spec: SemanticPromptTextPropertySpec,
  lifecycle: "static" | "dynamic",
  view: SemanticAnalyzerView,
  seen: Set<string>,
): readonly SemanticPromptTextCandidateEdge[] {
  const unwrapped = view.syntax.unwrapExpression(expression);
  const direct = collectPromptTextValue(
    expression,
    unwrapped,
    spec,
    lifecycle,
    view,
    seen,
    "anonymous-fragment",
    { ownerTag, interpolationIndex, expression },
  );
  if (direct.length > 0) return direct;

  return view.syntax.children(unwrapped).flatMap((child) => {
    if (view.syntax.isKind(child, "classDeclaration")) {
      return [];
    }
    return collectNestedDescendant(child, spec, lifecycle, view, seen);
  });
}

function collectNestedDescendant(
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
    "anonymous-fragment",
  );
  if (direct.length > 0) return direct;
  return view.syntax.children(unwrapped).flatMap((child) => {
    if (view.syntax.isKind(child, "classDeclaration")) {
      return [];
    }
    return collectNestedDescendant(child, spec, lifecycle, view, seen);
  });
}
