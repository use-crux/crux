import type {
  ProjectRelation,
  ProjectSourceRef,
} from "@use-crux/core/project-index";
import { operationPolicyOptions } from "../media/operation-safety-references";
import type { SemanticAnalyzerNode, SemanticAnalyzerView } from "./candidates";
import { propertyInitializer } from "./model/object-readers";
import { semanticTargetForExpression } from "./model/target-resolution";
import { projectRelation } from "../relations";
import { semanticSourceForNode } from "./syntax-readers";

/** Safe semantic references from one authored media operation to its policies. */
export interface SemanticMediaPolicyEvidence {
  readonly sourceRefs: readonly {
    readonly definitionId: string;
    readonly ref: ProjectSourceRef;
  }[];
  readonly relations: readonly ProjectRelation[];
}

/** Resolve Safety configuration and policy identity without retaining values. */
export function semanticMediaPolicyEvidence(
  definitionId: string,
  config: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticMediaPolicyEvidence {
  const sourceRefs = safetySourceRefs(definitionId, config, view);
  const relations = operationPolicyOptions.flatMap(([type, property]) => {
    const value = propertyInitializer(config, property, view);
    if (!value) return [];
    const array = view.syntax.unwrapExpression(value);
    if (!view.syntax.isKind(array, "arrayLiteral")) return [];
    return view.syntax.arrayElements(array).flatMap((element) => {
      const target = semanticTargetForExpression(element, view);
      if (!target) return [];
      return [
        projectRelation({
          type,
          from: target.id,
          to: definitionId,
          fidelity: "resolved",
          source: semanticSourceForNode(element, view.syntax),
        }),
      ];
    });
  });
  return { sourceRefs, relations };
}

function safetySourceRefs(
  definitionId: string,
  config: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticMediaPolicyEvidence["sourceRefs"] {
  const safety = propertyInitializer(config, "safety", view);
  if (!safety) return [];
  const source = semanticSourceForNode(safety, view.syntax);
  return [
    {
      definitionId,
      ref: {
        id: `${definitionId}:config:safety:${source.line}:${source.column}`,
        role: "config",
        property: "safety",
        source,
        fidelity: "resolved",
      },
    },
  ];
}
