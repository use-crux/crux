import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex } from "./adapt";
import { IndexIndexProvider, IndexSelectProvider } from "./context";
import { CatRelations } from "./detail";

const data = {
  prompts: [],
  contexts: [],
  tools: [],
  definitions: [
    {
      id: "thread:conversation",
      kind: "thread",
      name: "conversation",
      fidelity: "resolved",
      metadata: { facts: { kind: "thread" } },
    },
    {
      id: "prompt:answer",
      kind: "prompt",
      name: "answer",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "prompt",
          use: ["conversation"],
          useEntries: [
            {
              variable: "conversation",
              relationHint: "thread",
              targetDefinitionId: "thread:conversation",
              targetKind: "thread",
              relationType: "prompt.uses_thread",
              relationFidelity: "resolved",
              conditionality: "always",
              via: "direct",
            },
          ],
        },
      },
    },
  ],
  relations: [
    {
      id: "relation:prompt-thread",
      type: "prompt.uses_thread",
      from: "prompt:answer",
      to: "thread:conversation",
      fidelity: "resolved",
    },
  ],
  diagnostics: [],
  lintFindings: [],
  sources: [],
} satisfies ProjectIndexData;

function render(definitionId: string): string {
  const index = buildIndex(data);
  return renderToStaticMarkup(
    <IndexIndexProvider index={index}>
      <IndexSelectProvider select={() => undefined}>
        <CatRelations def={index.byId(definitionId)!} />
      </IndexSelectProvider>
    </IndexIndexProvider>,
  );
}

describe("Thread Catalog detail", () => {
  it("shows prompt.uses_thread from both definition directions", () => {
    const promptHtml = render("prompt:answer");
    expect(promptHtml).toContain("thread:conversation");
    expect(promptHtml).toContain("prompt.uses thread");

    const threadHtml = render("thread:conversation");
    expect(threadHtml).toContain("prompt:answer");
    expect(threadHtml).toContain("prompt.uses thread");
    expect(threadHtml).toContain("Used by · incoming");
  });
});
