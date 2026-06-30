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
    const binding = bindings.get(node.text);
    if (!binding || seen.has(binding.name)) return false;
    const nextSeen = new Set(seen);
    nextSeen.add(binding.name);
    return Boolean(
      (binding.initializer &&
        containsDataAccessCall(binding.initializer, bindings, nextSeen)) ||
      containsDataAccessCall(binding.declaration, bindings, nextSeen),
    );
  }
  let found = false;
  const visit = (child: Node): void => {
    if (found) return;
    if (
      isCallExpression(child) &&
      isPropertyAccessExpression(child.expression) &&
      dataAccessKindForMethod(child.expression.name.text)
    ) {
      found = true;
      return;
    }
    child.forEachChild(visit);
  };
  node.forEachChild(visit);
  return found;
}
