import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupPromptTextDiagnosticFixtures,
  promptTextDiagnosticFacts,
} from "./prompt-text-diagnostic-test-support";

afterEach(cleanupPromptTextDiagnosticFixtures);

describe("PromptText semantic diagnostics", () => {
  it("projects canonical md.json(undefined) evidence", async () => {
    const { facts, file } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        "",
        "export const writer = prompt({",
        `  id: "writer",`,
        "  prompt: md`Value ${md.json(undefined)}`,",
        "})",
      ].join("\n"),
    );
    const sourceRef = facts.sourceRefs?.find(
      ({ definitionId, ref }) =>
        definitionId === "prompt:writer" &&
        ref.metadata?.promptText?.lifecycle === "static",
    );

    expect(sourceRef).toBeDefined();
    expect(facts.lintFindings ?? []).toEqual([]);
    expect(facts.diagnostics).toEqual([
      {
        id: expect.stringMatching(/^prompt-text:[0-9a-f]{64}$/),
        severity: "error",
        code: "CRUX_PROMPT_TEXT_JSON_SERIALIZATION",
        message:
          "md.json() cannot produce text because JSON.stringify() is proven to return undefined for this value.",
        source: {
          file,
          line: 5,
          column: 22,
        },
        relatedDefinitionIds: ["prompt:writer"],
        evidence: {
          kind: "prompt-text",
          sourceRefId: sourceRef?.ref.id,
          interpolationIndex: 0,
          proof: "semantic-exact",
          cause: {
            kind: "json-serialization",
            reason: "undefined-result",
          },
        },
      },
    ]);
    expect(facts.diagnostics?.[0]).not.toHaveProperty("suggestedFix");
  });
});
