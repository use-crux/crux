/**
 * Invocation-level budget and step-hook evidence for indexed targets.
 *
 * @module
 */

import type { ProjectSourceRef } from "@use-crux/core/project-index";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerSourceFile,
  SemanticAnalyzerView,
} from "../candidates";
import {
  semanticObjectExpression,
  semanticTargetForExpression,
} from "../model";
import {
  semanticPropertyInitializer,
  semanticSourceForNode,
} from "../syntax-readers";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

export interface ContextPlanningOverrideEvidence {
  readonly counts: Readonly<Record<"inputBudget" | "prepareStep", number>>;
  readonly refs: readonly ProjectSourceRef[];
}

/** Find generate/stream/preview overrides whose indexed target is proven. */
export function semanticContextPlanningOverrides<
  TView extends SemanticAnalyzerView,
>(
  sourceFiles: readonly SemanticAnalyzerSourceFile<TView>[],
  view: TView,
): ReadonlyMap<string, ContextPlanningOverrideEvidence> {
  const mutable = new Map<
    string,
    {
      counts: Record<"inputBudget" | "prepareStep", number>;
      refs: ProjectSourceRef[];
    }
  >();

  for (const sourceFile of sourceFiles) {
    visit(sourceFile, view, (call) => {
      const name = view.syntax.callExpressionName(call);
      if (name !== "generate" && name !== "stream" && name !== "preview") {
        return;
      }
      const [targetExpression, optionsExpression] =
        view.syntax.callArguments(call);
      if (!targetExpression || !optionsExpression) return;
      const target = semanticTargetForExpression(targetExpression, view);
      if (target?.kind !== "prompt" && target?.kind !== "agent") return;
      const options = semanticObjectExpression(
        optionsExpression,
        view,
        new Set(),
      );
      if (!options) return;
      const evidence = mutable.get(target.id) ?? {
        counts: { inputBudget: 0, prepareStep: 0 },
        refs: [],
      };
      addOverride(target.id, options, "inputBudget", "config", evidence, view);
      addOverride(
        target.id,
        options,
        "prepareStep",
        "callback",
        evidence,
        view,
      );
      if (evidence.refs.length > 0) mutable.set(target.id, evidence);
    });
  }

  return new Map(
    [...mutable].map(([definitionId, evidence]) => [
      definitionId,
      {
        counts: { ...evidence.counts },
        refs: [...evidence.refs],
      },
    ]),
  );
}

function addOverride(
  definitionId: string,
  options: Node,
  property: "inputBudget" | "prepareStep",
  role: "config" | "callback",
  evidence: {
    counts: Record<"inputBudget" | "prepareStep", number>;
    refs: ProjectSourceRef[];
  },
  view: SemanticAnalyzerView,
): void {
  const node = semanticPropertyInitializer(options, property, view.syntax);
  if (!node) return;
  evidence.counts[property] += 1;
  const source = semanticSourceForNode(node, view.syntax);
  evidence.refs.push({
    id: `${definitionId}:source:${role}:${property}:${source.line}:${source.column}`,
    role,
    property,
    source,
    fidelity: "resolved",
  });
}

function visit(
  root: Node,
  view: SemanticAnalyzerView,
  callback: (call: Node) => void,
): void {
  if (view.syntax.isKind(root, "callExpression")) callback(root);
  view.syntax.children(root).forEach((child) => visit(child, view, callback));
}
