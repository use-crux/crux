import type { SignalTransportBindingFacts } from "@use-crux/core/project-index";
import { facts, none, type ExtractContext } from "../extensions";
import { internalStaticRecordContext } from "../static-index/compatibility/syntax-record-bridge/native-context";
import { createStaticRecordSourceResolver } from "../static-index/compatibility/syntax-record-bridge/source-resolver";
import {
  staticObjectPropertyValue,
  staticObjectValue,
  staticReferenceName,
  staticStringValue,
} from "../static-index/syntax/record/value";
import {
  configRefFact,
  liveFieldsFromOptions,
  providerIdFromResolved,
} from "./binding-values";
import { providerModules } from "./modules";

/** Projects one authored managed transport binding declaration. */
export function extractManagedTransportBindingStaticFacts(ctx: ExtractContext) {
  const native = internalStaticRecordContext(ctx);
  if (!native || native.match.kind !== "call") return none();
  if (
    native.match.callee.importedName !== "managedTransportBinding" &&
    native.match.callee.name !== "managedTransportBinding"
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

  const providerArg = native.match.args[0];
  const optionsArg = native.match.args[1];
  const providerVariable = staticReferenceName(providerArg);
  const resolver = createStaticRecordSourceResolver({
    record: native.record,
    initializers: native.initializers,
    initializerRecords: native.initializerRecords,
    ...(native.recordsByFile ? { recordsByFile: native.recordsByFile } : {}),
  });
  const providerResolved = resolver.resolveValue(providerArg);
  const resolvedProviderId = providerIdFromResolved(
    providerResolved,
    native.initializers,
  );
  const providerDefinitionId = resolvedProviderId
    ? `signal.provider:${ctx.source.safeId(resolvedProviderId)}`
    : undefined;
  const options = staticObjectValue(optionsArg, native.initializers);
  const bindingId = staticStringValue(
    options ? staticObjectPropertyValue(options, "id") : undefined,
    native.initializers,
  );
  const signalId = staticStringValue(
    options ? staticObjectPropertyValue(options, "signalId") : undefined,
    native.initializers,
  );
  const adapterId = staticStringValue(
    options ? staticObjectPropertyValue(options, "adapterId") : undefined,
    native.initializers,
  );
  const providerName = staticStringValue(
    options ? staticObjectPropertyValue(options, "provider") : undefined,
    native.initializers,
  );
  const configRef = configRefFact(
    options ? staticObjectPropertyValue(options, "configRef") : undefined,
    native.initializers,
  );
  const liveFields = liveFieldsFromOptions(options);
  const providerId = providerName ?? resolvedProviderId;
  const stable =
    Boolean(bindingId) &&
    Boolean(providerId) &&
    Boolean(signalId) &&
    configRef?.kind === "literal" &&
    liveFields.length === 0;
  const authoredIdentity = stable
    ? bindingId!
    : `${native.record.relativePath}:${native.match.source.line}:${native.match.source.column}`;
  const definitionId = `signal.transportBinding:${ctx.source.safeId(authoredIdentity)}`;
  const bindingFacts: SignalTransportBindingFacts = {
    kind: "signal.transportBinding",
    ...(bindingId ? { bindingId } : {}),
    identity: stable ? "static" : "partial",
    ...(providerVariable ? { providerVariable } : {}),
    ...(providerDefinitionId ? { providerDefinitionId } : {}),
    ...(providerId ? { providerId } : {}),
    ...(adapterId ? { adapterId } : {}),
    ...(configRef ? { configRef } : {}),
    ...(signalId ? { signalId } : {}),
    target: signalId
      ? { kind: "signal", signalId }
      : options &&
          staticReferenceName(staticObjectPropertyValue(options, "signalId"))
        ? { kind: "unresolved" }
        : { kind: "dynamic" },
    ...(liveFields.length ? { liveFields } : {}),
  };
  const references = [
    ...(providerDefinitionId
      ? [
          ctx.ref.id(
            "signal.transportBinding.binds_provider",
            providerDefinitionId,
          ),
        ]
      : providerVariable
        ? [
            ctx.ref.variable(
              "signal.transportBinding.binds_provider",
              providerVariable,
            ),
          ]
        : []),
    ...(signalId
      ? [
          ctx.ref.id(
            "signal.transportBinding.targets_signal",
            `signal:${ctx.source.safeId(signalId)}`,
          ),
        ]
      : []),
  ];
  const sourceRefs = [
    ...[
      "id",
      "configRef",
      "signalId",
      "provider",
      "adapterId",
      ...liveFields,
    ].flatMap((propertyName) => {
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
            description: `Authored managed transport binding ${propertyName} expression.`,
          },
        },
      ];
    }),
    ...(providerResolved
      ? [
          {
            definitionId,
            ref: resolver.sourceRef({
              definitionId,
              role: "config",
              property: "provider",
              resolved: providerResolved,
            }),
          },
        ]
      : []),
  ];

  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id: definitionId,
        kind: "signal.transportBinding",
        name: bindingId ?? ctx.source.variableName,
        metadata: {
          exportName: ctx.source.variableName,
          ...(ctx.source.exported ? { exported: true } : {}),
          facts: bindingFacts,
        },
      }),
    ],
    ...(references.length ? { references } : {}),
    ...(sourceRefs.length ? { sourceRefs } : {}),
  });
}
