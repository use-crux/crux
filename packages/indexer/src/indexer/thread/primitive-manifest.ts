import { extractThreadStaticFacts } from "./static-facts";

/** Declarative TypeScript compatibility coverage for authored Threads. */
export const threadPrimitiveContributions = Object.freeze({
  extractors: [
    {
      name: "thread",
      patterns: [
        {
          kind: "call" as const,
          name: "thread",
          importFrom: ["@use-crux/core/thread"],
          configArg: 0,
        },
        {
          kind: "call" as const,
          name: "prompt",
          importFrom: ["@use-crux/core"],
          configArg: 0,
        },
      ],
      extract: extractThreadStaticFacts,
    },
  ],
});
