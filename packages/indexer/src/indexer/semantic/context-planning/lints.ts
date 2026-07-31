/**
 * Conclusive semantic diagnostics for context-planning composition.
 *
 * @module
 */

import type { IndexLintFinding } from "@use-crux/core/project-index";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
} from "../candidates";
import { semanticSourceForNode } from "../syntax-readers";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

/** Create one history-cardinality finding without retaining contributor text. */
export function historyCardinalityFinding(
  candidate: SemanticDefinitionCandidate,
  node: Node,
  count: number,
  view: SemanticAnalyzerView,
): IndexLintFinding {
  return finding({
    ruleId: "context-planning.history-cardinality",
    candidate,
    node,
    view,
    message: `Prompt composition declares ${count} history projections; exactly one may own canonical history.`,
    impact:
      "Multiple projections make history ownership and causal grouping ambiguous.",
    fix: "Keep one history() or history.recent() entry in the prompt use array.",
  });
}

/** Create one invalid-wrapper-order finding from compiler-proven call structure. */
export function invalidWrapperOrderFinding(
  candidate: SemanticDefinitionCandidate,
  node: Node,
  view: SemanticAnalyzerView,
): IndexLintFinding {
  return finding({
    ruleId: "context-planning.invalid-wrapper-order",
    candidate,
    node,
    view,
    message:
      "Representation wrappers are not ordered prefer → summarizable → offloadable → droppable.",
    impact:
      "The authored ladder does not define one monotonic, capability-safe degradation path.",
    fix: "Make droppable outermost and use each non-terminal wrapper at most once in fidelity order.",
  });
}

function finding(input: {
  readonly ruleId:
    | "context-planning.history-cardinality"
    | "context-planning.invalid-wrapper-order";
  readonly candidate: SemanticDefinitionCandidate;
  readonly node: Node;
  readonly view: SemanticAnalyzerView;
  readonly message: string;
  readonly impact: string;
  readonly fix: string;
}): IndexLintFinding {
  const source = semanticSourceForNode(input.node, input.view.syntax);
  return {
    id: `${input.ruleId}:${input.candidate.definitionId}:${source.line}:${source.column}`,
    ruleId: input.ruleId,
    severity: "error",
    category: "contracts",
    maturity: "preview",
    confidence: "high",
    profiles: ["recommended", "strict"],
    title: input.ruleId,
    message: input.message,
    rationale:
      "The compiler proved the invalid composition from canonical helper calls and authored source structure.",
    impact: input.impact,
    source,
    primaryDefinitionId: input.candidate.definitionId,
    relatedDefinitionIds: [],
    evidence: [
      {
        kind: "source",
        label: "Resolved context-planning structure",
        source,
        data: { source: "semantic", fidelity: "resolved" },
      },
    ],
    fixes: [
      {
        title: "Correct the request composition",
        description: input.fix,
        kind: "manual",
      },
    ],
    docsUrl: "/docs/guides/context-planning",
  };
}
