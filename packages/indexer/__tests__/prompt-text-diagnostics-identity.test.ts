import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupPromptTextDiagnosticFixtures,
  promptTextDiagnosticFacts,
} from "./prompt-text-diagnostic-test-support";
import { createTypeScriptSemanticFactInput } from "../src/indexer/semantic/backends/typescript/fact-input";

afterEach(cleanupPromptTextDiagnosticFixtures);

describe("PromptText diagnostic identity joins", () => {
  it("attaches nested conclusions to their own source ref and local index", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `const inner = md\`Inner \${true}\``,
        `const outer = md\`Outer \${inner}\``,
        `export const writer = prompt({ id: "writer", prompt: outer })`,
      ].join("\n"),
    );
    const refs = (facts.sourceRefs ?? []).filter(
      ({ definitionId, ref }) =>
        definitionId === "prompt:writer" && ref.metadata?.promptText,
    );
    const inner = refs.find(({ ref }) => ref.snippet?.source.includes("Inner"));
    const outer = refs.find(({ ref }) => ref.snippet?.source.includes("Outer"));

    expect(inner).toBeDefined();
    expect(outer).toBeDefined();
    expect(facts.diagnostics).toEqual([
      expect.objectContaining({
        relatedDefinitionIds: ["prompt:writer"],
        evidence: expect.objectContaining({
          sourceRefId: inner?.ref.id,
          interpolationIndex: 0,
        }),
      }),
    ]);
    expect(facts.diagnostics?.[0]?.evidence?.sourceRefId).not.toBe(
      outer?.ref.id,
    );
  });

  it("retains exact dynamic owner lifecycle", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `const content = () => md\`Value \${true}\``,
        `export const writer = prompt({ id: "writer", prompt: content })`,
      ].join("\n"),
    );
    const ref = facts.sourceRefs?.find(
      ({ definitionId, ref }) =>
        definitionId === "prompt:writer" && ref.metadata?.promptText,
    );

    expect(ref?.ref.metadata?.promptText?.lifecycle).toBe("dynamic");
    expect(facts.diagnostics).toEqual([
      expect.objectContaining({
        evidence: expect.objectContaining({
          sourceRefId: ref?.ref.id,
        }),
      }),
    ]);
  });

  it("emits nothing for local and shadowed md lookalikes", async () => {
    const { facts } = await promptTextDiagnosticFacts(
      [
        `import { prompt } from "@use-crux/core"`,
        `const md = Object.assign((strings: TemplateStringsArray) => strings[0], { json: (_value: unknown) => ({}) })`,
        `export const local = prompt({ id: "local", prompt: md\`\${true}\` })`,
        `export const localJson = prompt({ id: "local-json", prompt: md\`\${md.json(undefined)}\` })`,
      ].join("\n"),
    );

    expect(facts.diagnostics).toEqual([]);
  });

  it("uses one-based UTF-16 points for complete interpolation expressions", async () => {
    const expressionLine = `  prompt: md\`🙂 prefix \${(true as true)}\`,`;
    const { facts, file } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `export const writer = prompt({`,
        `  id: "writer",`,
        expressionLine,
        `})`,
      ].join("\r\n"),
    );

    expect(facts.diagnostics?.[0]?.source).toEqual({
      file,
      line: 4,
      column: expressionLine.indexOf("(true as true)") + 1,
    });
  });

  it("suppresses ambiguous duplicate source-ref joins", async () => {
    const { facts, file, root } = await promptTextDiagnosticFacts(
      [
        `import { md, prompt } from "@use-crux/core"`,
        `export const writer = prompt({ id: "writer", prompt: md\`\${true}\` })`,
      ].join("\n"),
    );
    const sourceRef = facts.sourceRefs?.find(
      ({ definitionId, ref }) =>
        definitionId === "prompt:writer" && ref.metadata?.promptText,
    );
    expect(sourceRef).toBeDefined();
    if (!sourceRef)
      throw new Error("Expected canonical PromptText source ref.");
    const input = createTypeScriptSemanticFactInput(root, [file]);

    expect(
      input.promptTextDiagnosticConclusions?.([sourceRef, sourceRef]),
    ).toEqual([]);
  });
});
