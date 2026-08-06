import { extractSessionStaticFacts } from "./static-facts";

const sessionModules = ["@use-crux/core", "@use-crux/core/session"] as const;

/** Declarative static extraction coverage for authored Session access. */
export const sessionPrimitiveContributions = Object.freeze({
  extractors: [
    {
      name: "session",
      patterns: [
        {
          kind: "call" as const,
          name: "session",
          importFrom: sessionModules,
          configArg: 1,
        },
        {
          kind: "call" as const,
          name: "getSession",
          importFrom: sessionModules,
        },
      ],
      extract: extractSessionStaticFacts,
    },
  ],
  relations: [
    {
      type: "session.targets_agent",
      fromKinds: ["session"] as const,
      toKinds: ["agent"] as const,
      presentation: "both" as const,
      fidelity: "resolved" as const,
      runtimeJoin: true,
    },
    {
      type: "session.targets_flow",
      fromKinds: ["session"] as const,
      toKinds: ["flow"] as const,
      presentation: "both" as const,
      fidelity: "resolved" as const,
      runtimeJoin: true,
    },
    {
      type: "session.subscribes_to_signal",
      fromKinds: ["session"] as const,
      toKinds: ["signal"] as const,
      presentation: "both" as const,
      fidelity: "partial" as const,
      runtimeJoin: true,
    },
  ],
});
