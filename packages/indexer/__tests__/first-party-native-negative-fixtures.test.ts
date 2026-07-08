import { describe, expect } from "vitest";
import {
  extractNativeAndFallback,
  expectNativeExtractionParity,
  itWithRustOxc,
  nativeFactCount,
} from "./native-first-party-fixture-helpers";

interface NegativeFixtureCase {
  readonly family: string;
  readonly callNames: readonly string[];
  readonly constructorNames?: readonly string[];
}

const negativeFixtureCases: readonly NegativeFixtureCase[] = [
  {
    family: "rag.retriever",
    callNames: [
      "knowledgeBase",
      "retriever",
      "retrievalRecipe",
      "retrieve",
      "rerank",
      "reranker",
    ],
  },
  { family: "safety", callNames: ["constraint", "guardrail"] },
  { family: "scorer", callNames: ["llmJudge"] },
  { family: "workspace", callNames: ["workspace"] },
  { family: "eval", callNames: ["evaluate"] },
  { family: "skill-registry", callNames: ["registry"] },
  { family: "registry-skill", callNames: ["fromRegistry"] },
  { family: "tool", callNames: ["createTool", "tool"] },
  { family: "injectable", callNames: ["injectable"] },
  { family: "context", callNames: ["context"] },
  { family: "prompt", callNames: ["prompt"] },
  {
    family: "agent",
    callNames: ["agent", "convexAgent"],
    constructorNames: ["Agent"],
  },
  {
    family: "composition",
    callNames: ["parallel", "pipeline", "consensus", "swarm"],
  },
  {
    family: "memory",
    callNames: [
      "memory",
      "createMemoryId",
      "workingState",
      "episodes",
      "durableStore",
    ],
  },
  { family: "blackboard", callNames: ["blackboard", "createMemoryId"] },
  {
    family: "routing",
    callNames: ["router", "split", "retry", "cascade", "fallback"],
  },
  { family: "flow", callNames: ["flow"] },
];

describe("first-party native negative fixtures", () => {
  itWithRustOxc(
    "does not emit native facts for first-party factory lookalikes",
    async () => {
      for (const testCase of negativeFixtureCases) {
        const { fallbackOut, nativeOut, record } =
          await extractNativeAndFallback({
            source: lookalikeSource(testCase),
            callNames: testCase.callNames,
            ...(testCase.constructorNames
              ? { constructorNames: testCase.constructorNames }
              : {}),
          });

        expect(
          nativeFactCount(record, testCase.family),
          `${testCase.family} native facts`,
        ).toBe(0);
        expectNativeExtractionParity(nativeOut, fallbackOut);
      }
    },
    30_000,
  );
});

function lookalikeSource(testCase: NegativeFixtureCase): string {
  const functionNames = testCase.callNames.map(
    (name) => `const ${safeIdentifier(name)} = '${name}'`,
  );
  const constructorNames = (testCase.constructorNames ?? []).map(
    (name) => `class ${safeIdentifier(name)} {}`,
  );
  const properties = [
    ...testCase.callNames,
    ...(testCase.constructorNames ?? []),
  ]
    .map((name) => `${safeIdentifier(name)}: '${name}'`)
    .join(", ");
  return [
    ...functionNames,
    ...constructorNames,
    `export const lookalikes = { ${properties} }`,
  ].join("\n");
}

function safeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_$]/g, "_");
}
