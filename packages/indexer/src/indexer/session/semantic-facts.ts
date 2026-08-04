import { relative } from "node:path";
import type {
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

  for (const call of semanticDescendants(sourceFiles, view)) {
    if (!view.syntax.isKind(call, "callExpression")) continue;
    const operation = sessionOperation(call, view);
    if (!operation) continue;
    const args = view.syntax.callArguments(call);
    const targetExpression = args[0];
    if (!targetExpression) continue;
    const target = semanticTargetForExpression(targetExpression, view);
    const key = sessionKey(operation, args[1], view);
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
      key:
        key !== undefined
          ? { kind: "literal", value: key }
          : { kind: "dynamic" },
      identity: stable ? "static" : "partial",
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

  return {
    definitions: definitions.sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    sourceRefs: sourceRefs.sort((left, right) =>
      left.ref.id.localeCompare(right.ref.id),
    ),
    relations: relations.sort((left, right) => left.id.localeCompare(right.id)),
  };
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
