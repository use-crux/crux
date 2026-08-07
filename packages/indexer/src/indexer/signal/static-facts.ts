import type {
  SignalFacts,
  SignalProviderFacts,
  SignalTransportFacts,
} from "@use-crux/core/project-index";
import { facts, none, type ExtractContext } from "../extensions";
import { internalStaticRecordContext } from "../static-index/compatibility/syntax-record-bridge/native-context";
import { createStaticRecordSourceResolver } from "../static-index/compatibility/syntax-record-bridge/source-resolver";
import {
  staticObjectPropertyValue,
  staticObjectValue,
  staticReferenceName,
  staticStringValue,
} from "../static-index/syntax/record/value";
import { authoredTransportKind, signalMapEntries } from "./binding-values";
import { providerModules, transportModules } from "./modules";

export { extractManagedTransportBindingStaticFacts } from "./binding-static-facts";
export { extractPollingStaticFacts } from "./polling-static-facts";
export { extractSseStaticFacts } from "./sse-static-facts";
export { extractStreamStaticFacts } from "./stream-static-facts";

/** Projects canonical exported Signal definitions and their authored schema. */
export function extractSignalStaticFacts(ctx: ExtractContext) {
  if (ctx.match.name !== "signal" || !ctx.config) return none();
  const native = internalStaticRecordContext(ctx);
  if (!native || native.match.kind !== "call") return none();
  const signalId = ctx.config.string("id");
  const identity = signalId ? ("static" as const) : ("partial" as const);
  const authoredIdentity =
    signalId ??
    `${native.record.relativePath}:${native.match.source.line}:${native.match.source.column}`;
  const definitionId = `signal:${ctx.source.safeId(authoredIdentity)}`;
  const schema = ctx.sourceRef.schemaProperty({
    property: "schema",
    definitionId,
  });

  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id: definitionId,
        kind: "signal",
        name: signalId ?? ctx.source.variableName,
        metadata: {
          exportName: ctx.source.variableName,
          ...(ctx.source.exported ? { exported: true } : {}),
          ...(schema.schema ? { schema: schema.schema } : {}),
          facts: {
            kind: "signal",
            ...(signalId ? { signalId } : {}),
            identity,
          } satisfies SignalFacts,
        },
      }),
    ],
    sourceRefs: schema.sourceRefs,
  });
}

/** Projects one authored webhook transport declaration. */
export function extractWebhookStaticFacts(ctx: ExtractContext) {
  const native = internalStaticRecordContext(ctx);
  if (!native || native.match.kind !== "call") return none();
  if (
    native.match.callee.importedName !== "webhook" &&
    native.match.callee.name !== "webhook"
  ) {
    return none();
  }
  const moduleSpecifier = native.match.callee.moduleSpecifier;
  if (
    !moduleSpecifier ||
    !(transportModules as readonly string[]).includes(moduleSpecifier)
  ) {
    return none();
  }
  const options = staticObjectValue(native.match.args[0], native.initializers);
  const hasHandle = Boolean(
    options?.properties.some(
      (property) => !property.spread && property.name === "handle",
    ),
  );
  const authoredIdentity = `${native.record.relativePath}:${native.match.source.line}:${native.match.source.column}`;
  const definitionId = `signal.transport:${ctx.source.safeId(authoredIdentity)}`;
  const transportFacts: SignalTransportFacts = {
    kind: "signal.transport",
    transportKind: "webhook",
    hasHandle,
  };
  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id: definitionId,
        kind: "signal.transport",
        name: ctx.source.variableName,
        metadata: {
          exportName: ctx.source.variableName,
          ...(ctx.source.exported ? { exported: true } : {}),
          facts: transportFacts,
        },
      }),
    ],
  });
}

/** Projects one authored Signal provider definition. */
export function extractSignalProviderStaticFacts(ctx: ExtractContext) {
  const native = internalStaticRecordContext(ctx);
  if (!native || native.match.kind !== "call") return none();
  if (
    native.match.callee.importedName !== "signalProvider" &&
    native.match.callee.name !== "signalProvider"
  ) {
    return none();
  }
  const moduleSpecifier = native.match.callee.moduleSpecifier;
  if (
    !moduleSpecifier ||
    !(providerModules as readonly string[]).includes(moduleSpecifier)
  ) {
    return none();
  }

  const options = staticObjectValue(native.match.args[0], native.initializers);
  const providerId = staticStringValue(
    options ? staticObjectPropertyValue(options, "id") : undefined,
    native.initializers,
  );
  const identity = providerId ? ("static" as const) : ("partial" as const);
  const authoredIdentity = providerId
    ? providerId
    : `${native.record.relativePath}:${native.match.source.line}:${native.match.source.column}`;
  const definitionId = `signal.provider:${ctx.source.safeId(authoredIdentity)}`;
  const resolver = createStaticRecordSourceResolver({
    record: native.record,
    initializers: native.initializers,
    initializerRecords: native.initializerRecords,
    ...(native.recordsByFile ? { recordsByFile: native.recordsByFile } : {}),
  });
  const transportValue = options
    ? staticObjectPropertyValue(options, "transport")
    : undefined;
  const transportResolved = resolver.resolveValue(transportValue);
  const transportVariable =
    transportValue?.kind === "identifier" ||
    transportValue?.kind === "property-access"
      ? staticReferenceName(transportValue)
      : undefined;
  const transportKind = authoredTransportKind(transportResolved, transportValue);
  const inlineTransportDefinitionId =
    transportKind && transportValue?.kind === "call"
      ? `signal.transport:${ctx.source.safeId(`${native.record.relativePath}:${transportValue.source.line}:${transportValue.source.column}`)}`
      : undefined;
  const signalsValue = options
    ? staticObjectPropertyValue(options, "signals")
    : undefined;
  const signalMap = signalMapEntries(
    signalsValue,
    native.initializers,
    (value) => resolver.resolveValue(value),
  );
  const hasOnEvent = Boolean(
    options?.properties.some(
      (property) => !property.spread && property.name === "onEvent",
    ),
  );
  const providerFacts: SignalProviderFacts = {
    kind: "signal.provider",
    ...(providerId ? { providerId } : {}),
    identity,
    ...(transportKind ? { transportKind } : {}),
    ...(transportVariable ? { transportVariable } : {}),
    ...(signalMap.signalIds.length ? { signalIds: signalMap.signalIds } : {}),
    ...(signalMap.signalVariables.length
      ? { signalVariables: signalMap.signalVariables }
      : {}),
    hasOnEvent,
  };
  const references = [
    ...(transportVariable
      ? [ctx.ref.variable("signal.provider.uses_transport", transportVariable)]
      : inlineTransportDefinitionId
        ? [
            ctx.ref.id(
              "signal.provider.uses_transport",
              inlineTransportDefinitionId,
            ),
          ]
        : []),
    ...signalMap.signalVariables.map((variable) =>
      ctx.ref.variable("signal.provider.publishes_signal", variable),
    ),
  ];
  const sourceRefs = ["id", "transport", "signals", "onEvent"].flatMap(
    (propertyName) => {
      const authored = options?.properties.find(
        (property) => !property.spread && property.name === propertyName,
      );
      if (!authored) return [];
      return [
        {
          definitionId,
          ref: {
            id: `${definitionId}:source:config:${propertyName}:${authored.source.line}:${authored.source.column}`,
            role: "config" as const,
            property: propertyName,
            source: authored.source,
            fidelity: "resolved" as const,
            description: `Authored Signal provider ${propertyName} expression.`,
          },
        },
      ];
    },
  );

  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id: definitionId,
        kind: "signal.provider",
        name: providerId ?? ctx.source.variableName,
        metadata: {
          exportName: ctx.source.variableName,
          ...(ctx.source.exported ? { exported: true } : {}),
          facts: providerFacts,
        },
      }),
    ],
    ...(references.length ? { references } : {}),
    ...(sourceRefs.length ? { sourceRefs } : {}),
  });
}
