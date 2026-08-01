import type { ProjectSourceRef } from "@use-crux/core/project-index";
import { safeId } from "../../../definitions";
import {
  effectFacts,
  literalString,
  objectValue,
  pathIdentity,
} from "./effect-static-options";
import type {
  StaticCallSourceMatch,
  StaticFunctionCallValue,
  StaticObjectValue,
  StaticSourceMatch,
  StaticSyntaxValue,
} from "./types";
import {
  createStaticSyntaxInitializerMap,
  resolveStaticSyntaxValue,
  type StaticSyntaxInitializerMap,
} from "./value";

const PUBLIC_EFFECT_MODULES = new Set([
  "@use-crux/core",
  "@use-crux/core/effect",
]);

/** Returns certain required-boundary evidence keyed by Effect definition id. */
export function effectRequiredBoundarySourceRefs(
  relativePath: string,
  matches: readonly StaticSourceMatch[],
): ReadonlyMap<string, readonly ProjectSourceRef[]> {
  const refs = new Map<string, ProjectSourceRef[]>();
  for (const boundary of matches) {
    if (
      !isPublicBoundaryCall(boundary) ||
      !isRequiredBoundary(boundary.args[1])
    ) {
      continue;
    }
    const callback = boundary.args[0];
    if (callback?.kind !== "function") continue;
    const initializers = createStaticSyntaxInitializerMap(
      boundary.localInitializers ?? [],
    );
    for (const call of callback.calls) {
      const target = resolveEffectTarget(call, initializers);
      if (!target) continue;
      const effectId = literalString(target.args[0]);
      const options = objectValue(target.args[2]);
      const facts = effectFacts(effectId, options, target.args.length > 2);
      if (
        effectId === undefined ||
        facts.version === undefined ||
        facts.recoverable !== false
      ) {
        continue;
      }
      const definitionId = `effect:${safeId(effectId)}:v${facts.version}`;
      const ref: ProjectSourceRef = {
        id: `${definitionId}:source:required-boundary:${pathIdentity(relativePath)}:${boundary.source.line}:${boundary.source.column}:${call.source.line}:${call.source.column}`,
        role: "config",
        property: "rollbackOnError.recovery",
        symbol: "rollbackOnError",
        source: boundary.source,
        ...(boundary.snippet ? { snippet: boundary.snippet } : {}),
        fidelity: "resolved",
        description: `Required-recovery boundary contains irreversible Effect "${effectId}"`,
      };
      refs.set(definitionId, [...(refs.get(definitionId) ?? []), ref]);
    }
  }
  return refs;
}

function resolveEffectTarget(
  call: StaticFunctionCallValue,
  initializers: StaticSyntaxInitializerMap,
): Extract<StaticSyntaxValue, { readonly kind: "call" }> | undefined {
  const resolved = resolveLocalReference(callReference(call), initializers);
  return resolved?.kind === "call" && isPublicEffectValue(resolved)
    ? resolved
    : undefined;
}

function callReference(
  call: StaticFunctionCallValue,
): StaticSyntaxValue | undefined {
  const name = call.callee.localName ?? call.callee.name;
  if (call.callee.direct !== false) return { kind: "identifier", name };
  const path = referencePath(call.receiver);
  return path
    ? { kind: "property-access", name, path: [...path, name] }
    : undefined;
}

function referencePath(
  value: StaticSyntaxValue | undefined,
): readonly string[] | undefined {
  if (value?.kind === "identifier") return [value.name];
  if (value?.kind === "property-access") return value.path;
  return undefined;
}

function resolveLocalReference(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): StaticSyntaxValue | undefined {
  if (value?.kind !== "property-access") {
    return resolveStaticSyntaxValue(value, initializers);
  }
  const [root, ...properties] = value.path;
  if (!root) return undefined;
  let current = resolveStaticSyntaxValue(
    { kind: "identifier", name: root },
    initializers,
  );
  for (const property of properties) {
    if (current?.kind !== "object") return undefined;
    const next = certainObjectProperty(current, property);
    if (!next) return undefined;
    current = resolveStaticSyntaxValue(next, initializers);
  }
  return current;
}

function certainObjectProperty(
  object: StaticObjectValue,
  name: string,
): StaticSyntaxValue | undefined {
  if (object.properties.some((property) => property.spread === true)) {
    return undefined;
  }
  let value: StaticSyntaxValue | undefined;
  for (const property of object.properties) {
    if (property.name === name) value = property.value;
  }
  return value;
}

function isRequiredBoundary(options: StaticSyntaxValue | undefined): boolean {
  if (options === undefined) return true;
  if (options.kind !== "object") return false;
  if (options.properties.some((property) => property.spread === true)) {
    return false;
  }
  let recovery: StaticSyntaxValue | undefined;
  for (const property of options.properties) {
    if (property.name === "recovery") recovery = property.value;
  }
  return recovery === undefined || literalString(recovery) === "required";
}

function isPublicBoundaryCall(
  match: StaticSourceMatch,
): match is StaticCallSourceMatch {
  return (
    match.kind === "call" &&
    match.callee.name === "rollbackOnError" &&
    match.callee.direct !== false &&
    match.callee.moduleSpecifier !== undefined &&
    PUBLIC_EFFECT_MODULES.has(match.callee.moduleSpecifier)
  );
}

function isPublicEffectValue(
  value: Extract<StaticSyntaxValue, { readonly kind: "call" }>,
): boolean {
  return (
    value.callee.name === "effect" &&
    value.callee.direct !== false &&
    value.callee.moduleSpecifier !== undefined &&
    PUBLIC_EFFECT_MODULES.has(value.callee.moduleSpecifier)
  );
}
