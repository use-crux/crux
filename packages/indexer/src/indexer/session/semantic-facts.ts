import { relative } from "node:path";
import type {
  IndexLintFinding,
  ProjectDefinition,
  ProjectRelation,
  ProjectSourceRef,
  SessionFacts,
  SessionSubscriptionFacts,
  SessionUsageFacts,
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
import { resolveFlowSessionTarget } from "./semantic-flow-target";
import {
  collectSessionBindingUsage,
  foldUsage,
  mergeSessionUsage,
} from "./semantic-usage";

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

/** Projects Session identity, Agent/Flow targets, and linked usage evidence. */
export function semanticSessionFacts(
  root: string,
  sourceFiles: readonly SemanticAnalyzerSourceFile<SemanticAnalyzerView>[],
  view: SemanticAnalyzerView,
): SemanticSessionFactsResult {
  const definitions: ProjectDefinition[] = [];
  const sourceRefs: { definitionId: string; ref: ProjectSourceRef }[] = [];
  const relations: ProjectRelation[] = [];
  const sessionBindings = new Map<string, string>();
  const factsById = new Map<string, SessionFacts>();

  for (const call of semanticDescendants(sourceFiles, view)) {
    if (!view.syntax.isKind(call, "callExpression")) continue;
    const operation = sessionOperation(call, view);
    if (!operation) continue;
    const args = view.syntax.callArguments(call);
    const targetExpression = args[0];
    if (!targetExpression) continue;
    const target =
      semanticTargetForExpression(targetExpression, view) ??
      resolveFlowSessionTarget(targetExpression, view);
    const key = sessionKey(operation, args[1], view);
    const targetForm: SessionFacts["target"] =
      target?.kind === "agent" || target?.kind === "flow"
        ? { kind: target.kind }
        : semanticIsResolvableSourceExpression(targetExpression, view.syntax)
          ? { kind: "unresolved" }
          : { kind: "dynamic" };
    const source = semanticSourceForNode(call, view.syntax);
    const stable =
      (target?.kind === "agent" || target?.kind === "flow") && key !== undefined;
    const targetName =
      target?.kind === "agent" || target?.kind === "flow"
        ? target.id.split(":").slice(1).join(":")
        : undefined;
    const authoredIdentity = stable
      ? `${targetName}:${key}`
      : `${relative(root, source.file)}:${source.line}:${source.column}`;
    const definitionId = `session:${safeId(authoredIdentity)}`;
    const facts: SessionFacts = {
      kind: "session",
      operation,
      targetVariable: view.syntax.text(targetExpression),
      ...(target?.kind === "agent" || target?.kind === "flow"
        ? { targetDefinitionId: target.id }
        : {}),
      target: targetForm,
      key:
        key !== undefined
          ? { kind: "literal", value: key }
          : { kind: "dynamic" },
      identity: stable ? "static" : "partial",
      call: sessionCall(operation, args, view),
    };
    factsById.set(definitionId, facts);
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
    if (target?.kind === "agent" || target?.kind === "flow") {
      relations.push(
        projectRelation({
          type:
            target.kind === "agent"
              ? "session.targets_agent"
              : "session.targets_flow",
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

  const usageById = new Map<
    string,
    {
      usage: SessionUsageFacts;
      subscriptions: SessionSubscriptionFacts[];
    }
  >();
  const lintFindings: IndexLintFinding[] = [];

  for (const node of semanticDescendants(sourceFiles, view)) {
    if (!view.syntax.isKind(node, "callExpression")) continue;
    const collected = collectSessionBindingUsage(node, sessionBindings, view);
    if (!collected) continue;
    lintFindings.push(...collected.lintFindings);
    relations.push(...collected.relations);
    sourceRefs.push(...collected.sourceRefs);
    // Map usage back by finding which definition it belonged to via relations/source.
    // Subscription relations already carry `from`; method-only usage needs binding lookup.
    const definitionId =
      collected.relations[0]?.from ??
      collected.lintFindings[0]?.primaryDefinitionId ??
      usageDefinitionFromCall(node, sessionBindings, view);
    if (!definitionId) continue;
    const prior = usageById.get(definitionId);
    usageById.set(definitionId, {
      usage: foldUsage(prior?.usage, collected.usage),
      subscriptions: [
        ...(prior?.subscriptions ?? []),
        ...collected.subscriptions,
      ],
    });
  }

  for (const [definitionId, extra] of usageById) {
    const base = factsById.get(definitionId);
    if (!base) continue;
    factsById.set(
      definitionId,
      mergeSessionUsage(base, extra.usage, extra.subscriptions),
    );
  }

  return {
    definitions: definitions
      .map((definition) => {
        const facts = factsById.get(definition.id);
        return facts
          ? {
              ...definition,
              metadata: { ...definition.metadata, facts },
            }
          : definition;
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
    sourceRefs: sourceRefs.sort((left, right) =>
      left.ref.id.localeCompare(right.ref.id),
    ),
    relations: relations.sort((left, right) => left.id.localeCompare(right.id)),
    lintFindings: lintFindings.sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
}

function usageDefinitionFromCall(
  call: Node,
  sessionBindings: ReadonlyMap<string, string>,
  view: SemanticAnalyzerView,
): string | undefined {
  const methodAccess = view.syntax.callExpressionTarget(call);
  if (
    !methodAccess ||
    !view.syntax.isKind(methodAccess, "propertyAccessExpression")
  )
    return undefined;
  const sessionExpression = view.syntax.propertyAccessExpression(methodAccess);
  if (!sessionExpression) return undefined;
  const binding = view.syntax.identifierText(
    view.syntax.unwrapExpression(sessionExpression),
  );
  return binding ? sessionBindings.get(binding) : undefined;
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
