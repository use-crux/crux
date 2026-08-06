/** Backend-neutral Session method and subscription evidence on bindings. */

import type {
  IndexLintFinding,
  ProjectRelation,
  ProjectSourceRef,
  SessionFacts,
  SessionSubscriptionFacts,
  SessionUsageFacts,
} from "@use-crux/core/project-index";
import { safeId } from "../definitions";
import { projectRelation } from "../relations";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
} from "../semantic/candidates";
import {
  resolveSemanticExpression,
  semanticObjectExpression,
  semanticStringLiteralProperty,
} from "../semantic/model";
import { semanticResolvedSourceRef } from "../semantic/model/source-refs";
import {
  semanticIsResolvableSourceExpression,
  semanticSourceForNode,
} from "../semantic/syntax-readers";
import { signalModules } from "../signal/modules";
import { sessionThreadMutationFinding } from "./semantic-thread-lint";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

const sessionUsageMethods = new Set([
  "subscribe",
  "stream",
  "stats",
  "close",
  "kill",
  "delete",
  "fork",
  "clone",
]);

/** Accumulated method usage and Signal subscriptions for one Session binding. */
export interface SessionBindingUsage {
  readonly usage: SessionUsageFacts;
  readonly subscriptions: readonly SessionSubscriptionFacts[];
  readonly relations: readonly ProjectRelation[];
  readonly sourceRefs: readonly {
    readonly definitionId: string;
    readonly ref: ProjectSourceRef;
  }[];
  readonly lintFindings: readonly IndexLintFinding[];
}

/** Collect method usage, subscriptions, and Thread-mutation lints for bindings. */
export function collectSessionBindingUsage(
  call: Node,
  sessionBindings: ReadonlyMap<string, string>,
  view: SemanticAnalyzerView,
): SessionBindingUsage | undefined {
  const methodAccess = view.syntax.callExpressionTarget(call);
  if (
    !methodAccess ||
    !view.syntax.isKind(methodAccess, "propertyAccessExpression")
  )
    return undefined;
  const method = view.syntax.propertyAccessName(methodAccess);
  if (!method) return undefined;

  const threadAccess = view.syntax.propertyAccessExpression(methodAccess);
  if (
    threadAccess &&
    view.syntax.isKind(threadAccess, "propertyAccessExpression") &&
    view.syntax.propertyAccessName(threadAccess) === "thread"
  ) {
    const finding = sessionThreadMutationFinding(
      call,
      method,
      threadAccess,
      sessionBindings,
      view,
    );
    if (!finding) return undefined;
    return {
      usage: {},
      subscriptions: [],
      relations: [],
      sourceRefs: [],
      lintFindings: [finding],
    };
  }

  const sessionExpression = view.syntax.propertyAccessExpression(methodAccess);
  if (!sessionExpression) return undefined;
  const binding = view.syntax.identifierText(
    view.syntax.unwrapExpression(sessionExpression),
  );
  const definitionId = binding ? sessionBindings.get(binding) : undefined;
  if (!definitionId) return undefined;

  if (method === "subscribe") {
    return sessionSubscribeUsage(call, definitionId, view);
  }

  if (!sessionUsageMethods.has(method)) return undefined;
  return {
    usage: { [method]: true } as SessionUsageFacts,
    subscriptions: [],
    relations: [],
    sourceRefs: [],
    lintFindings: [],
  };
}

/** Merge per-call usage into SessionFacts fields. */
export function mergeSessionUsage(
  base: SessionFacts,
  usage: SessionUsageFacts | undefined,
  subscriptions: readonly SessionSubscriptionFacts[] | undefined,
): SessionFacts {
  const mergedUsage = usage && Object.keys(usage).length > 0 ? usage : undefined;
  const mergedSubscriptions =
    subscriptions && subscriptions.length > 0 ? subscriptions : undefined;
  if (!mergedUsage && !mergedSubscriptions) return base;
  return {
    ...base,
    ...(mergedUsage ? { usage: mergedUsage } : {}),
    ...(mergedSubscriptions ? { subscriptions: mergedSubscriptions } : {}),
  };
}

/** Fold successive method-usage maps. */
export function foldUsage(
  left: SessionUsageFacts | undefined,
  right: SessionUsageFacts,
): SessionUsageFacts {
  return { ...left, ...right };
}

function sessionSubscribeUsage(
  call: Node,
  definitionId: string,
  view: SemanticAnalyzerView,
): SessionBindingUsage {
  const args = view.syntax.callArguments(call);
  const sourceExpression = args[0];
  const source: {
    matchKind: SessionSubscriptionFacts["matchKind"];
    signalVariable?: string;
    signalDefinitionId?: string;
  } = sourceExpression
    ? analyzeSubscriptionSource(sourceExpression, view)
    : { matchKind: "dynamic" };
  const subscription: SessionSubscriptionFacts = {
    ...(source.signalVariable ? { signalVariable: source.signalVariable } : {}),
    ...(source.signalDefinitionId
      ? { signalDefinitionId: source.signalDefinitionId }
      : {}),
    matchKind: source.matchKind,
  };
  const relations: ProjectRelation[] = [];
  const sourceRefs: {
    definitionId: string;
    ref: ProjectSourceRef;
  }[] = [];
  if (source.signalDefinitionId && sourceExpression) {
    relations.push(
      projectRelation({
        type: "session.subscribes_to_signal",
        from: definitionId,
        to: source.signalDefinitionId,
        fidelity: "resolved",
        source: semanticSourceForNode(sourceExpression, view.syntax),
      }),
    );
    const ref = semanticResolvedSourceRef(
      definitionId,
      "subscribe",
      "config",
      sourceExpression,
      view,
    );
    if (ref) sourceRefs.push({ definitionId, ref });
  }
  return {
    usage: { subscribe: true },
    subscriptions: [subscription],
    relations,
    sourceRefs,
    lintFindings: [],
  };
}

function analyzeSubscriptionSource(
  expression: Node,
  view: SemanticAnalyzerView,
): {
  matchKind: SessionSubscriptionFacts["matchKind"];
  signalVariable?: string;
  signalDefinitionId?: string;
} {
  const unwrapped = view.syntax.unwrapExpression(expression);
  if (view.syntax.isKind(unwrapped, "callExpression")) {
    const target = view.syntax.callExpressionTarget(unwrapped);
    if (
      target &&
      view.syntax.isKind(target, "propertyAccessExpression") &&
      view.syntax.propertyAccessName(target) === "when"
    ) {
      const receiver = view.syntax.propertyAccessExpression(target);
      if (!receiver) return { matchKind: "dynamic" };
      const signal = resolveSignalDefinition(receiver, view);
      const signalVariable = view.syntax.text(receiver);
      if (signal) {
        return {
          matchKind: "when",
          signalVariable,
          signalDefinitionId: signal,
        };
      }
      if (semanticIsResolvableSourceExpression(receiver, view.syntax)) {
        return { matchKind: "when", signalVariable };
      }
      return { matchKind: "dynamic" };
    }
  }
  const signal = resolveSignalDefinition(unwrapped, view);
  const signalVariable = view.syntax.text(unwrapped);
  if (signal) {
    return {
      matchKind: "bare",
      signalVariable,
      signalDefinitionId: signal,
    };
  }
  if (semanticIsResolvableSourceExpression(unwrapped, view.syntax)) {
    return { matchKind: "bare", signalVariable };
  }
  if (semanticObjectExpression(unwrapped, view, new Set())) {
    return { matchKind: "dynamic" };
  }
  return { matchKind: "dynamic", signalVariable };
}

function resolveSignalDefinition(
  expression: Node,
  view: SemanticAnalyzerView,
): string | undefined {
  const unwrapped = view.syntax.unwrapExpression(expression);
  const direct = signalDefinitionFromCall(unwrapped, view);
  if (direct) return direct;
  if (!semanticIsResolvableSourceExpression(unwrapped, view.syntax)) {
    return undefined;
  }
  const resolved = resolveSemanticExpression(unwrapped, view);
  if (!resolved?.expression) return undefined;
  return signalDefinitionFromCall(
    view.syntax.unwrapExpression(resolved.expression),
    view,
  );
}

function signalDefinitionFromCall(
  expression: Node,
  view: SemanticAnalyzerView,
): string | undefined {
  if (!view.syntax.isKind(expression, "callExpression")) return undefined;
  const callee = view.syntax.callExpressionTarget(expression);
  if (!callee) return undefined;
  const isSignal = signalModules.some((moduleName) =>
    Boolean(view.canonicalExportIdentity(callee, moduleName, "signal")),
  );
  if (!isSignal) return undefined;
  const [config] = view.syntax.callArguments(expression);
  const object = config
    ? semanticObjectExpression(config, view, new Set())
    : undefined;
  if (!object) return undefined;
  const signalId = semanticStringLiteralProperty(object, "id", view);
  return signalId ? `signal:${safeId(signalId)}` : undefined;
}
