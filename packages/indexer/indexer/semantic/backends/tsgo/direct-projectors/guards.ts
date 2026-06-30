import {
  isCallExpression,
  isIdentifier,
  isPropertyAccessExpression,
  type Node,
} from "@typescript/native-preview/unstable/ast";
import { dataAccessKindForMethod } from "../../../../extractors/data-access-manifest";
import type { NativeDefinition } from "./types";
import type { NativeSourceBinding } from "./types";
import { propertyInitializer } from "./object";

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
    unsupportedPresentProperties(definition).some((property) =>
      Boolean(propertyInitializer(definition.object, property)),
    ) ||
    callbackProperties(definition).some((property) => {
      const initializer = propertyInitializer(definition.object, property);
      return initializer
        ? callbackRequiresSharedAnalyzer(initializer, bindings)
        : false;
    })
  );
}

function unsupportedPresentProperties(
  definition: NativeDefinition,
): readonly string[] {
  switch (definition.kind) {
    default:
      return [];
  }
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
      dataAccessKindForMethod(node.expression.name.text)
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
