import { relative } from "node:path";
import type {
  IndexLintFinding,
  ProjectDefinition,
  ProjectRelation,
  ProjectSourceRef,
  SessionFacts,
} from "@use-crux/core/project-index";
import { safeId } from "../definitions";
import { semanticDescendants } from "../embedding/semantic-values";
import { projectRelation } from "../relations";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerSourceFile,
  SemanticAnalyzerView,
} from "../semantic/candidates";
import {
  semanticObjectExpression,
  semanticTargetForExpression,
} from "../semantic/model";
import { semanticResolvedSourceRef } from "../semantic/model/source-refs";
import {
  semanticIsResolvableSourceExpression,
  semanticPropertyInitializer,
  semanticSourceForNode,
  semanticVariableNameForNode,
} from "../semantic/syntax-readers";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

const sessionModules = ["@use-crux/core", "@use-crux/core/session"] as const;

/** Backend-neutral facts derived from supported authored Session call forms. */
export interface SemanticSessionFactsResult {
  readonly definitions: readonly ProjectDefinition[];
  readonly sourceRefs: readonly {
    readonly definitionId: string;
    readonly ref: ProjectSourceRef;
  }[];
  readonly relations: readonly ProjectRelation[];
  readonly lintFindings: readonly IndexLintFinding[];
}

/** Projects Session identity and Agent target evidence through the shared analyzer. */
export function semanticSessionFacts(
  root: string,
  sourceFiles: readonly SemanticAnalyzerSourceFile<SemanticAnalyzerView>[],
  view: SemanticAnalyzerView,
): SemanticSessionFactsResult {
  const definitions: ProjectDefinition[] = [];
  const sourceRefs: { definitionId: string; ref: ProjectSourceRef }[] = [];
  const relations: ProjectRelation[] = [];
  const sessionBindings = new Map<string, string>();

  for (const call of semanticDescendants(sourceFiles, view)) {
    if (!view.syntax.isKind(call, "callExpression")) continue;
    const operation = sessionOperation(call, view);
    if (!operation) continue;
    const args = view.syntax.callArguments(call);
    const targetExpression = args[0];
    if (!targetExpression) continue;
    const target = semanticTargetForExpression(targetExpression, view);
    const key = sessionKey(operation, args[1], view);
    const targetForm: SessionFacts["target"] =
      target?.kind === "agent"
        ? { kind: "agent" }
        : semanticIsResolvableSourceExpression(targetExpression, view.syntax)
          ? { kind: "unresolved" }
          : { kind: "dynamic" };
    const source = semanticSourceForNode(call, view.syntax);
    const stable = target?.kind === "agent" && key !== undefined;
    const targetName =
      target?.kind === "agent" ? target.id.slice("agent:".length) : undefined;
    const authoredIdentity = stable
      ? `${targetName}:${key}`
      : `${relative(root, source.file)}:${source.line}:${source.column}`;
    const definitionId = `session:${safeId(authoredIdentity)}`;
    const facts: SessionFacts = {
      kind: "session",
      operation,
      targetVariable: view.syntax.text(targetExpression),
      ...(target?.kind === "agent" ? { targetDefinitionId: target.id } : {}),
      target: targetForm,
      key:
        key !== undefined
          ? { kind: "literal", value: key }
          : { kind: "dynamic" },
      identity: stable ? "static" : "partial",
      call: sessionCall(operation, args, view),
    };
    definitions.push({
      id: definitionId,
      kind: "session",
      name: stable
        ? `${targetName}:${key}`
        : (semanticVariableNameForNode(call, view.syntax) ?? "session"),
      source,
      fidelity: stable ? "resolved" : "partial",
      status: "active",
      metadata: { facts },
    });
    const binding = semanticVariableNameForNode(call, view.syntax);
    if (binding) sessionBindings.set(binding, definitionId);
    if (target?.kind === "agent") {
      relations.push(
        projectRelation({
          type: "session.targets_agent",
          from: definitionId,
          to: target.id,
          fidelity: "resolved",
          source: semanticSourceForNode(targetExpression, view.syntax),
        }),
      );
    }
    const ref = semanticResolvedSourceRef(
      definitionId,
      "target",
      "config",
      targetExpression,
      view,
    );
    if (ref) sourceRefs.push({ definitionId, ref });
  }

  const lintFindings = semanticDescendants(sourceFiles, view).flatMap(
    (node) => {
      if (!view.syntax.isKind(node, "callExpression")) return [];
      const mutation = sessionThreadMutation(node, sessionBindings, view);
      return mutation ? [mutation] : [];
    },
  );

  return {
    definitions: definitions.sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    sourceRefs: sourceRefs.sort((left, right) =>
      left.ref.id.localeCompare(right.ref.id),
    ),
    relations: relations.sort((left, right) => left.id.localeCompare(right.id)),
    lintFindings: lintFindings.sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
}

const sessionThreadMutationMethods = new Set([
  "append",
  "commitTurn",
  "delete",
  "edit",
  "redact",
  "select",
]);

function sessionThreadMutation(
  call: Node,
  sessionBindings: ReadonlyMap<string, string>,
  view: SemanticAnalyzerView,
): IndexLintFinding | undefined {
  const methodAccess = view.syntax.callExpressionTarget(call);
  if (
    !methodAccess ||
    !view.syntax.isKind(methodAccess, "propertyAccessExpression")
  )
    return undefined;
  const method = view.syntax.propertyAccessName(methodAccess);
  if (!method || !sessionThreadMutationMethods.has(method)) return undefined;
  const threadAccess = view.syntax.propertyAccessExpression(methodAccess);
  if (
    !threadAccess ||
    !view.syntax.isKind(threadAccess, "propertyAccessExpression") ||
    view.syntax.propertyAccessName(threadAccess) !== "thread"
  )
    return undefined;
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

function sessionCall(
  operation: "create" | "get",
  args: readonly Node[],
  view: SemanticAnalyzerView,
): SessionFacts["call"] {
  if (args.length !== 2) return { kind: "ambiguous", reason: "arity" };
  if (operation === "get") return { kind: "supported" };
  return semanticObjectExpression(args[1], view, new Set())
    ? { kind: "supported" }
    : { kind: "ambiguous", reason: "options" };
}

function sessionOperation(
  call: Node,
  view: SemanticAnalyzerView,
): "create" | "get" | undefined {
  const callee = view.syntax.callExpressionTarget(call);
  if (!callee) return undefined;
  if (canonicalSessionExport(callee, "session", view)) return "create";
  if (canonicalSessionExport(callee, "getSession", view)) return "get";
  return undefined;
}

function canonicalSessionExport(
  callee: Node,
  exportName: "session" | "getSession",
  view: SemanticAnalyzerView,
): boolean {
  return sessionModules.some((moduleName) =>
    Boolean(view.canonicalExportIdentity(callee, moduleName, exportName)),
  );
}

function sessionKey(
  operation: "create" | "get",
  expression: Node | undefined,
  view: SemanticAnalyzerView,
): string | undefined {
  if (!expression) return undefined;
  if (operation === "get")
    return view.syntax.stringLiteralText(
      view.syntax.unwrapExpression(expression),
    );
  const options = semanticObjectExpression(expression, view, new Set());
  const key = options
    ? semanticPropertyInitializer(options, "key", view.syntax)
    : undefined;
  return key
    ? view.syntax.stringLiteralText(view.syntax.unwrapExpression(key))
    : undefined;
}
