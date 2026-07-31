/**
 * Backend-neutral recognition of authored context-planning wrappers.
 *
 * @module
 */

import type { SemanticAnalyzerNode, SemanticAnalyzerView } from "../candidates";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

export type ContextPlanningWrapper =
  | "prefer"
  | "summarizable"
  | "offloadable"
  | "droppable";

export interface ContextPlanningWrapperAnalysis {
  readonly wrappers: readonly ContextPlanningWrapper[];
  readonly boundary: "required" | "sticky" | "elastic";
  readonly valid: boolean;
  readonly source: Node;
}

const wrapperRanks: Readonly<Record<ContextPlanningWrapper, number>> = {
  prefer: 0,
  summarizable: 1,
  offloadable: 2,
  droppable: 3,
};

/** Inspect one top-level `use` entry without accepting shadowed local helpers. */
export function contextPlanningWrapperAnalysis(
  expression: Node,
  view: SemanticAnalyzerView,
): ContextPlanningWrapperAnalysis {
  const wrappers: ContextPlanningWrapper[] = [];
  let node = view.syntax.unwrapExpression(expression);
  let valid = true;

  while (view.syntax.isKind(node, "callExpression")) {
    const wrapper = canonicalWrapperName(node, view);
    if (!wrapper) break;
    const args = view.syntax.callArguments(node);
    wrappers.push(wrapper);
    if (!args[0]) {
      valid = false;
      break;
    }
    if (
      wrapper === "prefer" &&
      args.slice(1).some((argument) => containsCanonicalWrapper(argument, view))
    ) {
      valid = false;
    }
    node = view.syntax.unwrapExpression(args[0]);
  }

  for (let index = 1; index < wrappers.length; index += 1) {
    if (wrapperRanks[wrappers[index - 1]] <= wrapperRanks[wrappers[index]]) {
      valid = false;
    }
  }

  if (canonicalHistoryKind(node, view)) valid = false;
  return {
    wrappers,
    boundary: wrappers.includes("droppable")
      ? "elastic"
      : wrappers.length > 0
        ? "sticky"
        : "required",
    valid,
    source: node,
  };
}

/** Return the canonical history projection kind for one expression. */
export function canonicalHistoryKind(
  expression: Node,
  view: SemanticAnalyzerView,
): "managed" | "recent" | undefined {
  const node = view.syntax.unwrapExpression(expression);
  if (!view.syntax.isKind(node, "callExpression")) return undefined;
  const target = view.syntax.callExpressionTarget(node);
  if (!target) return undefined;
  if (canonicalCoreExport(target, "history", view)) return "managed";
  if (view.syntax.propertyAccessName(target) !== "recent") return undefined;
  const receiver = view.syntax.propertyAccessExpression(target);
  return receiver && canonicalCoreExport(receiver, "history", view)
    ? "recent"
    : undefined;
}

function canonicalWrapperName(
  call: Node,
  view: SemanticAnalyzerView,
): ContextPlanningWrapper | undefined {
  const name = view.syntax.callExpressionName(call);
  if (!isWrapperName(name)) return undefined;
  const target = view.syntax.callExpressionTarget(call);
  return target && canonicalCoreExport(target, name, view) ? name : undefined;
}

function containsCanonicalWrapper(
  root: Node,
  view: SemanticAnalyzerView,
): boolean {
  let found = false;
  const visit = (node: Node): void => {
    if (found) return;
    if (
      view.syntax.isKind(node, "callExpression") &&
      canonicalWrapperName(node, view)
    ) {
      found = true;
      return;
    }
    view.syntax.children(node).forEach(visit);
  };
  visit(root);
  return found;
}

function canonicalCoreExport(
  node: Node,
  name: string,
  view: SemanticAnalyzerView,
): boolean {
  return Boolean(view.canonicalExportIdentity(node, "@use-crux/core", name));
}

function isWrapperName(
  value: string | undefined,
): value is ContextPlanningWrapper {
  return (
    value === "prefer" ||
    value === "summarizable" ||
    value === "offloadable" ||
    value === "droppable"
  );
}
