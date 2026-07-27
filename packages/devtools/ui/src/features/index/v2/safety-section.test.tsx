import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex } from "./adapt";
import { IndexIndexProvider } from "./context";
import { IndexSafety } from "./safety-section";

const data = {
  prompts: [],
  contexts: [],
  tools: [],
  definitions: [
    {
      id: "guardrail:portable-media",
      kind: "guardrail",
      name: "portableMedia",
      fidelity: "resolved",
      status: "active",
      metadata: {
        facts: {
          kind: "guardrail",
          boundary: "model.input.media",
          boundaries: ["model.input.media", "model.output.media"],
          strategy: {
            kind: "media",
            config: {
              mediaTypes: { allow: ["image/png"] },
              action: "strip",
            },
          },
        },
      },
    },
    {
      id: "media.operation:cover",
      kind: "media.operation",
      name: "cover",
      fidelity: "resolved",
      status: "active",
      metadata: {
        facts: {
          kind: "media.operation",
          operation: "generateImage",
          outputModalities: ["image"],
          execution: "native",
        },
      },
      sourceRefs: [
        {
          id: "source-ref:safety",
          role: "config",
          property: "safety",
          symbol: "imageSafety",
          source: { file: "src/media.ts", line: 12 },
          fidelity: "resolved",
        },
      ],
    },
    {
      id: "guardrail:tool-boundaries",
      kind: "guardrail",
      name: "toolBoundaries",
      fidelity: "resolved",
      status: "active",
      metadata: {
        facts: {
          kind: "guardrail",
          boundary: "model.input.tools",
          boundaries: ["model.input.tools"],
        },
      },
    },
  ],
  relations: [
    {
      id: "guardrail-applies",
      type: "guardrail.applies_to",
      from: "guardrail:portable-media",
      to: "media.operation:cover",
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
      <IndexSafety def={index.byId(definitionId)!} />
    </IndexIndexProvider>,
  );
}

describe("Safety Catalog detail", () => {
  it("renders policy boundaries, strategy, action, config, and target", () => {
    const html = render("guardrail:portable-media");
    expect(html).toContain("Safety policy");
    expect(html).toContain("Model input · Media");
    expect(html).not.toContain(">model.input.media<");
    expect(html).toContain("model.output.media");
    expect(html).toContain("guardrail.media");
    expect(html).toContain("strip");
    expect(html).toContain("image/png");
    expect(html).toContain("cover");
  });

  it("renders attached policies and authored Safety options on operations", () => {
    const html = render("media.operation:cover");
    expect(html).toContain("Safety attachments");
    expect(html).toContain("portableMedia");
    expect(html).toContain("model.output.media");
    expect(html).toContain("Safety options authored");
  });

  it("renders the canonical provider-visible tool boundary with friendly copy", () => {
    const html = render("guardrail:tool-boundaries");
    expect(html).toContain("Model input · Tools");
    expect(html).not.toContain(">model.input.tools<");
  });
});
