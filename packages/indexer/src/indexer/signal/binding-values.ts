import {
  SIGNAL_TRANSPORT_BINDING_LIVE_FIELDS,
  type SignalTransportBindingLiveField,
  SignalTransportBindingFacts,
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

const liveBindingFields = new Set<string>(SIGNAL_TRANSPORT_BINDING_LIVE_FIELDS);

/** Resolve whether a transport expression is an authored webhook, polling, or stream transport. */
export function authoredTransportKind(
  resolved: ResolvedStaticRecordSource | undefined,
  value: StaticSyntaxValue | undefined,
): "webhook" | "polling" | "stream" | undefined {
  const call = resolved?.value.kind === "call" ? resolved.value : value;
  if (call?.kind !== "call") return undefined;
  const name = call.callee.importedName ?? call.callee.name;
  if (name !== "webhook" && name !== "polling" && name !== "stream") {
    return undefined;
  }
  const moduleSpecifier = call.callee.moduleSpecifier;
  if (
    !moduleSpecifier ||
    !(transportModules as readonly string[]).includes(moduleSpecifier)
  ) {
    return undefined;
  }
  return name;
}

/** @deprecated Prefer {@link authoredTransportKind}. */
export function webhookTransportKind(
  resolved: ResolvedStaticRecordSource | undefined,
  value: StaticSyntaxValue | undefined,
): "webhook" | undefined {
  const kind = authoredTransportKind(resolved, value);
  return kind === "webhook" ? "webhook" : undefined;
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
      !moduleSpecifier ||
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

/** Resolve a signalProvider() call into its stable provider id. */
export function providerIdFromResolved(
  resolved: ResolvedStaticRecordSource | undefined,
  initializers: Parameters<typeof staticStringValue>[1],
): string | undefined {
  if (resolved?.value.kind !== "call") return undefined;
  const callee =
    resolved.value.callee.importedName ?? resolved.value.callee.name;
  if (callee !== "signalProvider") return undefined;
  const moduleSpecifier = resolved.value.callee.moduleSpecifier;
  if (
    !moduleSpecifier ||
    !(providerModules as readonly string[]).includes(moduleSpecifier)
  ) {
    return undefined;
  }
  const config = staticObjectValue(resolved.value.args[0], initializers);
  if (!config) return undefined;
  return staticStringValue(
    staticObjectPropertyValue(config, "id"),
    initializers,
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
        liveBindingFields.has(property.name),
    )
    .map((property) => property.name)
    .filter(isLiveBindingField)
    .sort();
}

function isLiveBindingField(
  value: string,
): value is SignalTransportBindingLiveField {
  return liveBindingFields.has(value);
}
