import type {
  SignalTransportBindingFacts,
  SignalTransportBindingLiveField,
} from "@use-crux/core/project-index";
import type { ResolvedStaticRecordSource } from "../static-index/compatibility/syntax-record-bridge/source-resolver";
import type { StaticSyntaxValue } from "../static-index/syntax/record/types";
import {
  staticObjectPropertyValue,
  staticObjectValue,
  staticReferenceName,
  staticStringValue,
} from "../static-index/syntax/record/value";
import { providerModules, signalModules, transportModules } from "./modules";

const liveBindingFields = new Set<SignalTransportBindingLiveField>([
  "request",
  "client",
  "credential",
  "credentials",
  "socket",
  "callback",
  "handle",
  "onEvent",
  "secret",
  "token",
  "password",
  "apiKey",
]);

/** Resolve whether a transport expression is an authored webhook. */
export function webhookTransportKind(
  resolved: ResolvedStaticRecordSource | undefined,
  value: StaticSyntaxValue | undefined,
): "webhook" | undefined {
  const call = resolved?.value.kind === "call" ? resolved.value : value;
  if (call?.kind !== "call") return undefined;
  const name = call.callee.importedName ?? call.callee.name;
  if (name !== "webhook") return undefined;
  const moduleSpecifier = call.callee.moduleSpecifier;
  if (
    moduleSpecifier &&
    !(transportModules as readonly string[]).includes(moduleSpecifier)
  ) {
    return undefined;
  }
  return "webhook";
}

/** Collect Signal map identities and variable names from an object literal. */
export function signalMapEntries(
  value: StaticSyntaxValue | undefined,
  initializers: Parameters<typeof staticStringValue>[1],
  resolveValue: (
    value: StaticSyntaxValue | undefined,
  ) => ResolvedStaticRecordSource | undefined,
): {
  readonly signalIds: readonly string[];
  readonly signalVariables: readonly string[];
} {
  const object = staticObjectValue(value, initializers);
  if (!object) return { signalIds: [], signalVariables: [] };
  const signalIds: string[] = [];
  const signalVariables: string[] = [];
  for (const property of object.properties) {
    if (property.spread || !property.name) continue;
    const variable = staticReferenceName(property.value);
    if (variable) signalVariables.push(variable);
    const resolved = resolveValue(property.value);
    const call =
      resolved?.value.kind === "call" ? resolved.value : property.value;
    if (call?.kind !== "call") continue;
    const callee = call.callee.importedName ?? call.callee.name;
    if (callee !== "signal") continue;
    const moduleSpecifier = call.callee.moduleSpecifier;
    if (
      moduleSpecifier &&
      !(signalModules as readonly string[]).includes(moduleSpecifier)
    ) {
      continue;
    }
    const config = staticObjectValue(call.args[0], initializers);
    if (!config) continue;
    const signalId = staticStringValue(
      staticObjectPropertyValue(config, "id"),
      initializers,
    );
    if (signalId) signalIds.push(signalId);
  }
  return {
    signalIds: [...new Set(signalIds)].sort(),
    signalVariables: [...new Set(signalVariables)].sort(),
  };
}

/** Resolve a signalProvider() call into a definition id. */
export function providerDefinitionIdFromResolved(
  resolved: ResolvedStaticRecordSource | undefined,
): string | undefined {
  const providerId = providerIdFromResolved(resolved);
  return providerId ? `signal.provider:${providerId}` : undefined;
}

/** Resolve a signalProvider() call into its stable provider id. */
export function providerIdFromResolved(
  resolved: ResolvedStaticRecordSource | undefined,
): string | undefined {
  if (resolved?.value.kind !== "call") return undefined;
  const callee =
    resolved.value.callee.importedName ?? resolved.value.callee.name;
  if (callee !== "signalProvider") return undefined;
  const moduleSpecifier = resolved.value.callee.moduleSpecifier;
  if (
    moduleSpecifier &&
    !(providerModules as readonly string[]).includes(moduleSpecifier)
  ) {
    return undefined;
  }
  const emptyInitializers = new Map() as Parameters<typeof staticStringValue>[1];
  const config = staticObjectValue(resolved.value.args[0], emptyInitializers);
  if (!config) return undefined;
  return staticStringValue(
    staticObjectPropertyValue(config, "id"),
    emptyInitializers,
  );
}

/** Project configRef evidence without retaining secrets. */
export function configRefFact(
  value: StaticSyntaxValue | undefined,
  initializers: Parameters<typeof staticStringValue>[1],
): SignalTransportBindingFacts["configRef"] | undefined {
  if (!value) return undefined;
  const object = staticObjectValue(value, initializers);
  if (!object) {
    return staticReferenceName(value)
      ? { kind: "partial" }
      : { kind: "dynamic" };
  }
  const id = staticStringValue(
    staticObjectPropertyValue(object, "id"),
    initializers,
  );
  const revision = staticStringValue(
    staticObjectPropertyValue(object, "revision"),
    initializers,
  );
  if (id && revision) return { kind: "literal", id, revision };
  return { kind: "partial" };
}

/** Collect forbidden live-value property names from binding options. */
export function liveFieldsFromOptions(
  options: ReturnType<typeof staticObjectValue>,
): readonly SignalTransportBindingLiveField[] {
  if (!options) return [];
  return options.properties
    .filter(
      (property): property is typeof property & { name: string } =>
        !property.spread &&
        typeof property.name === "string" &&
        liveBindingFields.has(property.name as SignalTransportBindingLiveField),
    )
    .map((property) => property.name as SignalTransportBindingLiveField)
    .sort();
}
