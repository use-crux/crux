/** Semantic lint for non-owner Session Thread mutations. */

import type { IndexLintFinding } from "@use-crux/core/project-index";
import { safeId } from "../definitions";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
} from "../semantic/candidates";
import { semanticSourceForNode } from "../semantic/syntax-readers";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

const sessionThreadMutationMethods = new Set([
  "append",
  "commitTurn",
  "delete",
  "edit",
  "redact",
  "select",
]);

/** Emit a finding when a Session Thread view calls a mutating method. */
export function sessionThreadMutationFinding(
  call: Node,
  method: string,
  threadAccess: Node,
  sessionBindings: ReadonlyMap<string, string>,
  view: SemanticAnalyzerView,
): IndexLintFinding | undefined {
  if (!sessionThreadMutationMethods.has(method)) return undefined;
  const sessionExpression = view.syntax.propertyAccessExpression(threadAccess);
  if (!sessionExpression) return undefined;
  const binding = view.syntax.identifierText(
    view.syntax.unwrapExpression(sessionExpression),
  );
  const definitionId = binding ? sessionBindings.get(binding) : undefined;
  if (!definitionId) return undefined;
  const source = semanticSourceForNode(call, view.syntax);
  return {
    id: `lint:session.non_owner_thread_mutation:${safeId(`${definitionId}:${source.file}:${source.line}:${source.column}:${method}`)}`,
    ruleId: "session.non_owner_thread_mutation",
    severity: "error",
    category: "runtime",
    maturity: "stable",
    confidence: "high",
    profiles: ["recommended", "strict"],
    title: "Session Thread view is mutated outside its owner",
    message: `Session Thread view calls mutating method \"${method}\" outside the Session owner.`,
    rationale:
      "A Session Thread view is read-only because only the owning Session may publish its canonical head.",
    impact:
      "Non-owner mutation is rejected by the linearizable Thread owner fence and cannot safely publish Session history.",
    source,
    primaryDefinitionId: definitionId,
    relatedDefinitionIds: [definitionId],
    evidence: [
      {
        kind: "source",
        label: "Non-owner Session Thread mutation",
        source,
        data: { method, sessionDefinitionId: definitionId },
      },
    ],
    fixes: [
      {
        title: "Send input through the Session",
        description:
          "Use session.send() or session.sendMany(); keep session.thread for read-only inspection.",
        kind: "manual",
      },
    ],
    docsUrl:
      "/docs/reference/crux-core/index-lints/session-non-owner-thread-mutation",
  };
}
