import type { NativeDirectPrimitiveSpec } from "./manifest";

/**
 * Direct-native manifest entries for first-party routing primitives.
 *
 * Routing owns its source refs and child/target facts in specialized projector
 * modules; these entries declare only the primitive identity fields that the
 * shared direct projector needs to recognize local definitions.
 */
export const nativeDirectRoutingPrimitiveManifest = [
  {
    callName: "router",
    definitionKind: "routing.router",
    nameProperties: ["id"],
    emitDefinition: "withMetadata",
    schema: [],
    sourceRefs: [{ property: "classify", role: "callback" }],
    dependencies: [],
  },
  {
    callName: "split",
    definitionKind: "routing.split",
    nameProperties: ["id"],
    emitDefinition: "withMetadata",
    schema: [],
    sourceRefs: [{ property: "seed", role: "callback" }],
    dependencies: [],
  },
  {
    callName: "retry",
    definitionKind: "routing.retry",
    nameProperties: ["id"],
    emitDefinition: "withMetadata",
    schema: [],
    sourceRefs: [],
    dependencies: [],
  },
  {
    callName: "cascade",
    definitionKind: "routing.cascade",
    nameProperties: ["id"],
    emitDefinition: "withMetadata",
    schema: [],
    sourceRefs: [],
    dependencies: [],
  },
  {
    callName: "fallback",
    definitionKind: "routing.fallback",
    nameProperties: ["id"],
    emitDefinition: "withMetadata",
    schema: [],
    sourceRefs: [
      { property: "when", role: "policy" },
      { property: "onFallback", role: "callback" },
      { property: "shouldFallback", role: "policy" },
      { property: "onAttemptError", role: "callback" },
    ],
    dependencies: [],
  },
] as const satisfies readonly NativeDirectPrimitiveSpec[];
