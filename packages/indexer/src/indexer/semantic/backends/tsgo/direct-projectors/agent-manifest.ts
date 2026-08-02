import type { NativeDirectPrimitiveSpec } from "./manifest";

/**
 * Direct-native manifest entries for first-party agent primitives.
 */
export const nativeDirectAgentPrimitiveManifest = [
  {
    callName: "agent",
    definitionKind: "agent",
    nameProperties: ["id", "name"],
    emitDefinition: "withMetadata",
    schema: [],
    sourceRefs: [
      { property: "prompt", role: "config" },
      { property: "contextHandler", role: "callback" },
      { property: "usageHandler", role: "callback" },
      { property: "prepare", role: "callback" },
    ],
    dependencies: [
      {
        kind: "identifierProperty",
        property: "prompt",
        targetKind: "prompt",
        relationType: "agent.uses_prompt",
        relationOrigin: { kind: "owner" },
      },
      {
        kind: "identifierProperty",
        property: "model",
        targetKinds: [
          "routing.router",
          "routing.split",
          "routing.retry",
          "routing.cascade",
          "routing.fallback",
        ],
        relationType: "agent.uses_routing",
        relationOrigin: { kind: "owner" },
      },
      {
        kind: "identifierProperty",
        property: "languageModel",
        targetKinds: [
          "routing.router",
          "routing.split",
          "routing.retry",
          "routing.cascade",
          "routing.fallback",
        ],
        relationType: "agent.uses_routing",
        relationOrigin: { kind: "owner" },
      },
      {
        kind: "objectShorthand",
        property: "tools",
        targetKind: "tool",
        relationType: "agent.uses_tool",
        relationOrigin: { kind: "owner" },
        sourceRef: {
          role: "config",
          property: "tools",
          metadata: { toolMapContributor: "property" },
        },
      },
      {
        kind: "objectShorthand",
        property: "tools",
        targetKind: "agent",
        relationType: "agent.uses_agent_tool",
        relationOrigin: { kind: "owner" },
        sourceRef: {
          role: "config",
          property: "tools",
          metadata: { toolMapContributor: "property" },
        },
      },
      {
        kind: "staticIdArray",
        property: "handoffs",
        targetKind: "agent",
        relationType: "agent.can_handoff_to",
        relationOrigin: { kind: "owner" },
      },
    ],
  },
] as const satisfies readonly NativeDirectPrimitiveSpec[];
