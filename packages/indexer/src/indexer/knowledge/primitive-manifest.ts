import { extractKnowledgeStaticFacts } from "./static-facts";

const knowledgeModules = [
  "@use-crux/core/knowledge",
  "@use-crux/core/retrieval",
  "@use-crux/core",
] as const;

/** Declarative TypeScript compatibility coverage for Connected Knowledge. */
export const knowledgePrimitiveContributions = Object.freeze({
  extractors: [
    {
      name: "knowledge",
      patterns: [
        {
          kind: "call" as const,
          name: "knowledgeBase",
          importFrom: knowledgeModules,
          configArg: 0,
        },
        {
          kind: "call" as const,
          name: "relate",
          importFrom: ["@use-crux/core/knowledge"],
          configArg: 0,
        },
        {
          kind: "call" as const,
          name: "relateReferences",
          importFrom: ["@use-crux/core/knowledge"],
          configArg: 0,
        },
        {
          kind: "call" as const,
          name: "relateEntities",
          importFrom: ["@use-crux/core/knowledge"],
          configArg: 0,
        },
        {
          kind: "call" as const,
          name: "assertions",
          importFrom: ["@use-crux/core/knowledge"],
          configArg: 0,
        },
        {
          kind: "call" as const,
          name: "communities",
          importFrom: ["@use-crux/core/knowledge"],
          configArg: 0,
        },
        {
          kind: "call" as const,
          name: "knowledgeModel",
          importFrom: ["@use-crux/core/knowledge"],
          configArg: 0,
        },
        {
          kind: "call" as const,
          name: "view",
          configArg: 0,
        },
      ],
      extract: extractKnowledgeStaticFacts,
    },
  ],
});
