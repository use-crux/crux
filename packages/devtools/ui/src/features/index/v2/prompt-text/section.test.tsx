import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import conformanceFixture from "../../../../../../../indexer/__tests__/fixtures/prompt-text-editor-conformance-v1.json";
import type {
  IndexDiagnostic,
  ProjectIndexData,
  ProjectSourceRef,
} from "@/types";
import { buildIndex } from "../adapt";
import { IndexIndexProvider, IndexSelectProvider } from "../context";
import { PromptTextSection } from "./section";

const promptTextIndex = {
  project: { root: "/workspace" },
  prompts: [],
  contexts: [],
  tools: [],
  definitions: [
    {
      id: "prompt:writer",
      kind: "prompt",
      name: "writer",
      fidelity: "resolved",
      source: { file: "/workspace/src/writer.ts", line: 2, column: 1 },
      sourceRefs: [
        {
          id: "source-ref:writer-prompt",
          role: "prompt",
          property: "prompt",
          source: { file: "/workspace/src/writer.ts", line: 3, column: 11 },
          snippet: {
            source: "md`Hello ${shared}`",
            language: "typescript",
            range: {
              file: "/workspace/src/writer.ts",
              startLine: 3,
              startColumn: 11,
              endLine: 3,
              endColumn: 30,
            },
          },
          fidelity: "resolved",
          metadata: {
            promptText: {
              tag: "md",
              language: "markdown",
              lifecycle: "static",
              sourceKind: "owner",
              fragmentJoins: [
                {
                  kind: "named-fragment",
                  ownerSourceRefId: "source-ref:writer-prompt",
                  ownerTemplateRange: {
                    file: "/workspace/src/writer.ts",
                    startLine: 3,
                    startColumn: 11,
                    endLine: 3,
                    endColumn: 30,
                  },
                  interpolationIndex: 0,
                  expressionRange: {
                    file: "/workspace/src/writer.ts",
                    startLine: 3,
                    startColumn: 22,
                    endLine: 3,
                    endColumn: 28,
                  },
                  targetSourceRefId: "source-ref:shared",
                  targetTemplateRange: {
                    file: "/workspace/src/writer.ts",
                    startLine: 1,
                    startColumn: 16,
                    endLine: 1,
                    endColumn: 26,
                  },
                  proof: "semantic-exact",
                },
              ],
            },
          },
        },
        {
          id: "source-ref:shared",
          role: "prompt",
          property: "prompt",
          symbol: "shared",
          source: { file: "/workspace/src/writer.ts", line: 1, column: 16 },
          snippet: {
            source: "md`Shared`",
            language: "typescript",
            range: {
              file: "/workspace/src/writer.ts",
              startLine: 1,
              startColumn: 16,
              endLine: 1,
              endColumn: 26,
            },
          },
          fidelity: "resolved",
          metadata: {
            promptText: {
              tag: "md",
              language: "markdown",
              lifecycle: "static",
              sourceKind: "named-fragment",
            },
          },
        },
        {
          id: "source-ref:writer-system",
          role: "system",
          property: "system",
          source: { file: "/workspace/src/writer.ts", line: 2, column: 11 },
          snippet: {
            source: '"System instructions"',
            language: "typescript",
            range: {
              file: "/workspace/src/writer.ts",
              startLine: 2,
              startColumn: 11,
              endLine: 2,
              endColumn: 32,
            },
          },
          fidelity: "resolved",
          metadata: {
            promptTextRefactor: {
              kind: "ordinary-string-to-md",
              proof: "semantic-exact",
              lifecycle: "static",
              target: "md",
              binding: { kind: "identifier", expression: "md" },
            },
          },
        },
      ],
    },
  ],
  relations: [],
  diagnostics: [
    {
      id: "prompt-text:invalid",
      severity: "error",
      code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
      message: "PromptText interpolation cannot render boolean.",
      source: {
        file: "/workspace/src/writer.ts",
        line: 3,
        column: 22,
      },
      relatedDefinitionIds: ["prompt:writer"],
      evidence: {
        kind: "prompt-text",
        sourceRefId: "source-ref:writer-prompt",
        interpolationIndex: 0,
        proof: "semantic-exact",
        cause: {
          kind: "invalid-interpolation",
          runtimeKinds: ["boolean"],
        },
      },
    },
  ],
  lintFindings: [],
  sources: [],
} satisfies ProjectIndexData;

describe("Catalog PromptText evidence", () => {
  it("renders the shared compiler conformance evidence after Devtools adaptation", () => {
    const semantic = conformanceFixture.semantic as unknown as {
      readonly definitionId: string;
      readonly sourceRef: ProjectSourceRef;
      readonly diagnostics: readonly IndexDiagnostic[];
    };
    const index = buildIndex({
      project: { root: "/repo" },
      prompts: [],
      contexts: [],
      tools: [],
      definitions: [
        {
          id: semantic.definitionId,
          kind: "prompt",
          name: "editor-conformance",
          fidelity: "resolved",
          source: {
            file: "/repo/src/prompt-text-editor-conformance-v1.ts",
            line: 14,
          },
          sourceRefs: [semantic.sourceRef],
        },
      ],
      relations: [],
      diagnostics: [...semantic.diagnostics],
      lintFindings: [],
      sources: [],
    });
    const html = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexSelectProvider select={() => undefined}>
          <PromptTextSection def={index.byId(semantic.definitionId)!} />
        </IndexSelectProvider>
      </IndexIndexProvider>,
    );

    expect(html).toContain("Canonical md");
    expect(html).toContain("Owner");
    expect(html).toContain("Static · direct");
    expect(html).toContain("named-fragment join #5");
    expect(html).toContain("CRUX_PROMPT_TEXT_INLINE_SEQUENCE");
    expect(html).toContain("CRUX_PROMPT_TEXT_INVALID_INTERPOLATION");
    expect(html).toContain("CRUX_PROMPT_TEXT_JSON_SERIALIZATION");
    expect(html).toContain("boolean");
  });

  it("retains a real Project Index payload through adaptation and renders its evidence", () => {
    const index = buildIndex(promptTextIndex);
    const html = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexSelectProvider select={() => undefined}>
          <PromptTextSection def={index.byId("prompt:writer")!} />
        </IndexSelectProvider>
      </IndexIndexProvider>,
    );

    expect(html).toContain("PromptText");
    expect(html).toContain("Canonical md");
    expect(html).toContain("Markdown");
    expect(html).toContain("Owner");
    expect(html).toContain("Static · direct");
    expect(html).toContain("Named fragment");
    expect(html).toContain("source-ref:shared");
    expect(html).toContain("ordinary string → md");
    expect(html).toContain("CRUX_PROMPT_TEXT_INVALID_INTERPOLATION");
    expect(html).toContain("invalid interpolation");
    expect(html).toContain("boolean");
    expect(html).toContain("src/writer.ts:3:22");
  });
});
