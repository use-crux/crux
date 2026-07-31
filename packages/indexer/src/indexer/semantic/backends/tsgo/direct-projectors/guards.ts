import {
  SyntaxKind,
  isArrowFunction,
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isMethodDeclaration,
  isPropertyAssignment,
  isPropertyAccessExpression,
  type Node,
} from "@typescript/native-preview/unstable/ast";
import { dataAccessKindForMethod } from "../../../data-access-manifest";
import { workspaceSnapshotAccessForMethod } from "../../../workspace-snapshot-access";
import type { NativeDefinition } from "./types";
import type { NativeSourceBinding } from "./types";
import { nativeNodeList } from "../source";
import { propertyInitializer, propertyName } from "./object";

/**
 * Returns whether a direct-native definition uses semantic shapes the direct
 * projector does not yet emit. These files must route through the complete
 * native shared analyzer to preserve exact backend parity.
 */
export function hasUnsupportedSemanticProperty(
  definition: NativeDefinition,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): boolean {
  return (
    hasContextPlanningUse(definition) ||
    unsupportedPresentProperties(definition).some((property) =>
      Boolean(propertyInitializer(definition.object, property)),
    ) ||
    callbackProperties(definition).some((property) => {
      const initializer = propertyInitializer(definition.object, property);
      return initializer
        ? callbackRequiresSharedAnalyzer(initializer, bindings)
        : false;
    }) ||
    promptTextRequiresSharedAnalyzer(definition, bindings)
  );
}

function promptTextRequiresSharedAnalyzer(
  definition: NativeDefinition,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): boolean {
  return (definition.primitive.promptText ?? []).some((spec) => {
    const property = nativeNodeList(definition.object.properties).find(
      (candidate) =>
        (isPropertyAssignment(candidate) || isMethodDeclaration(candidate)) &&
        propertyName(candidate.name) === spec.property,
    );
    if (!property) return false;
    if (isMethodDeclaration(property)) {
      return containsBroadCallbackControlFlow(property);
    }
    const initializer = propertyInitializer(definition.object, spec.property);
    const callback = initializer && callbackNode(initializer, bindings);
    return callback ? containsBroadCallbackControlFlow(callback) : false;
  });
}

function callbackNode(
  node: Node,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): Node | undefined {
  if (isArrowFunction(node) || isFunctionExpression(node)) return node;
  if (!isIdentifier(node)) return undefined;
  const binding = bindings.get(node.text);
  if (!binding) return undefined;
  if (isFunctionDeclaration(binding.declaration)) return binding.declaration;
  return binding.initializer &&
    (isArrowFunction(binding.initializer) ||
      isFunctionExpression(binding.initializer))
    ? binding.initializer
    : undefined;
}

function containsBroadCallbackControlFlow(callback: Node): boolean {
  let unsupported = false;
  const visit = (node: Node): void => {
    if (unsupported) return;
    if (node !== callback && isNestedExecutionBoundary(node)) return;
    if (broadControlFlowKinds.has(node.kind)) {
      unsupported = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(callback);
  return unsupported;
}

const broadControlFlowKinds: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.DoStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.TryStatement,
]);

function isNestedExecutionBoundary(node: Node): boolean {
  return (
    isArrowFunction(node) ||
    isFunctionExpression(node) ||
    isFunctionDeclaration(node) ||
    isMethodDeclaration(node) ||
    isClassDeclaration(node) ||
    isClassExpression(node) ||
    node.kind === SyntaxKind.GetAccessor ||
    node.kind === SyntaxKind.SetAccessor
  );
}

function unsupportedPresentProperties(
  definition: NativeDefinition,
): readonly string[] {
  switch (definition.kind) {
    case "agent":
      return ["inputBudget", "prepareStep"];
    case "composition.parallel":
    case "composition.pipeline":
    case "composition.swarm":
    case "composition.consensus":
      return ["prepareInvocation"];
    default:
      return [];
  }
}

function hasContextPlanningUse(definition: NativeDefinition): boolean {
  if (definition.kind !== "prompt" && definition.kind !== "context") {
    return false;
  }
  const use = propertyInitializer(definition.object, "use");
  if (!use) return false;
  let found = false;
  const visit = (node: Node): void => {
    if (found) return;
    if (isCallExpression(node)) {
      const target = node.expression;
      const name = isIdentifier(target)
        ? target.text
        : isPropertyAccessExpression(target)
          ? target.name.text
          : undefined;
      if (
        name === "history" ||
        name === "recent" ||
        name === "prefer" ||
        name === "summarizable" ||
        name === "offloadable" ||
        name === "droppable"
      ) {
        found = true;
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(use);
  return found;
}

function callbackProperties(definition: NativeDefinition): readonly string[] {
  switch (definition.kind) {
    case "prompt":
      return ["prompt", "system"];
    case "context":
      return ["resolve", "render", "handler", "when", "system"];
    case "tool":
      return ["execute", "run", "handler"];
    case "agent":
      return [
        "handler",
        "run",
        "execute",
        "contextHandler",
        "usageHandler",
        "prepare",
      ];
    default:
      return [];
  }
}

function callbackRequiresSharedAnalyzer(
  node: Node,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): boolean {
  if (!isIdentifier(node)) {
    return containsDataAccessCall(node, bindings);
  }

  return bindings.has(node.text)
    ? containsDataAccessCall(node, bindings)
    : true;
}

function containsDataAccessCall(
  node: Node,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (isIdentifier(node)) {
    return containsDataAccessCallInBinding(node.text, bindings, seen);
  }
  if (isCallExpression(node)) {
    if (
      isPropertyAccessExpression(node.expression) &&
      (dataAccessKindForMethod(node.expression.name.text) ||
        isWorkspaceSnapshotFacetCall(node.expression))
    ) {
      return true;
    }
    if (
      isIdentifier(node.expression) &&
      containsDataAccessCallInBinding(node.expression.text, bindings, seen)
    ) {
      return true;
    }
  }
  let found = false;
  const visit = (child: Node): void => {
    if (found) return;
    found = containsDataAccessCall(child, bindings, seen);
  };
  node.forEachChild(visit);
  return found;
}

function isWorkspaceSnapshotFacetCall(node: Node): boolean {
  if (!isPropertyAccessExpression(node)) return false;
  if (!workspaceSnapshotAccessForMethod(node.name.text)) return false;
  return (
    isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "snapshot"
  );
}

function containsDataAccessCallInBinding(
  symbol: string,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
  seen: ReadonlySet<string>,
): boolean {
  const binding = bindings.get(symbol);
  if (!binding || seen.has(binding.name)) return false;
  const nextSeen = new Set(seen);
  nextSeen.add(binding.name);
  return Boolean(
    (binding.initializer &&
      containsDataAccessCall(binding.initializer, bindings, nextSeen)) ||
    containsDataAccessCall(binding.declaration, bindings, nextSeen),
  );
}
