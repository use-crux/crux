/** Resolve Flow Session targets for the public flow(name, …) form. */

import { safeId } from "../definitions";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
} from "../semantic/candidates";
import {
  resolveSemanticExpression,
  semanticObjectExpression,
  semanticStringLiteralProperty,
  unwrapExpression,
} from "../semantic/model";
import { semanticIsResolvableSourceExpression } from "../semantic/syntax-readers";
import { flowModules } from "./flow-modules";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

/**
 * Resolve Flow Session targets for the public flow(name, …) form.
 *
 * @remarks Shared `semanticTargetForExpression` maps object-config factories;
 * Flow's stable name is the first string argument. Call identity must prove a
 * canonical `flow` export from an allowed Crux Flow module.
 */
export function resolveFlowSessionTarget(
  expression: Node,
  view: SemanticAnalyzerView,
): { id: string; kind: "flow" } | undefined {
  const unwrapped = unwrapExpression(expression, view);
  const fromCall = flowTargetFromCall(unwrapped, view);
  if (fromCall) return fromCall;
  if (!semanticIsResolvableSourceExpression(unwrapped, view.syntax)) {
    return undefined;
  }
  const resolved = resolveSemanticExpression(unwrapped, view);
  if (!resolved?.expression) return undefined;
  return flowTargetFromCall(unwrapExpression(resolved.expression, view), view);
}

function flowTargetFromCall(
  expression: Node,
  view: SemanticAnalyzerView,
): { id: string; kind: "flow" } | undefined {
  if (!view.syntax.isKind(expression, "callExpression")) return undefined;
  const callee = view.syntax.callExpressionTarget(expression);
  if (!callee || !canonicalFlowExport(callee, view)) return undefined;
  const [firstArg] = view.syntax.callArguments(expression);
  if (!firstArg) return undefined;
  const stringName = view.syntax.stringLiteralText(
    view.syntax.unwrapExpression(firstArg),
  );
  const object = semanticObjectExpression(firstArg, view, new Set());
  const objectName = object
    ? semanticStringLiteralProperty(object, "name", view)
    : undefined;
  const identity = stringName ?? objectName;
  return identity
    ? { id: `flow:${safeId(identity)}`, kind: "flow" }
    : undefined;
}

function canonicalFlowExport(
  callee: Node,
  view: SemanticAnalyzerView,
): boolean {
  return flowModules.some((moduleName) =>
    Boolean(view.canonicalExportIdentity(callee, moduleName, "flow")),
  );
}
