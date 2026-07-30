import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import promptTextRun from "../../../../../../core/src/observability/fixtures/prompt-text-run.json";
import type { ObservabilityRunDetailNode } from "@/types";
import { RunDetailUserPrompt, UserPromptCard } from "./user-prompt";

describe("Run Detail user prompt", () => {
  it("renders exact mixed PromptText with provenance and token attribution", () => {
    const html = renderToStaticMarkup(
      <UserPromptCard
        promptText={{
          kind: "prompt-text",
          text: 'Hello Ada\nNested 値\n{\n  "ready": true\n}',
          segments: [
            { text: "Hello ", dynamic: false },
            { text: "Ada", dynamic: true, source: "name" },
            { text: "\nNested ", dynamic: false },
            { text: "値", dynamic: true, source: "fragment.value" },
            { text: '\n{\n  "ready": true\n}', dynamic: true },
          ],
          tokens: 14,
          staticTokens: 4,
          dynamicTokens: 10,
        }}
      />,
    );

    expect(html).toContain("User · prompt");
    expect(html).toContain("authored");
    expect(html).toContain("interpolated");
    expect(html).toContain("name");
    expect(html).toContain("fragment.value");
    expect(html).toContain("source · name");
    expect(html).toContain("source · fragment.value");
    expect(html).toContain("static · 4");
    expect(html).toContain("dynamic · 10");
    expect(html).toContain("total · 14");
    expect(html).toContain("Nested ");
    expect(html).toContain(">値</span>");
    expect(html).toContain("&quot;ready&quot;: true");
  });

  it("fails closed to plain text when provenance does not reconstruct", () => {
    const html = renderToStaticMarkup(
      <UserPromptCard
        plainText="Hello Ada"
        promptText={{
          kind: "prompt-text",
          text: "Hello Ada",
          segments: [{ text: "different", dynamic: false }],
          tokens: 2,
          staticTokens: 2,
          dynamicTokens: 0,
        }}
      />,
    );

    expect(html).toContain("Hello Ada");
    expect(html).not.toContain("authored");
    expect(html).not.toContain("interpolated");
  });

  it("keeps ordinary string prompts on the plain-text presentation", () => {
    const html = renderToStaticMarkup(
      <UserPromptCard plainText="ordinary string" />,
    );

    expect(html).toContain("ordinary string");
    expect(html).not.toContain("static ·");
    expect(html).not.toContain("dynamic ·");
  });

  it("renders the shared ordinary-Run fixture from the Run Detail response", () => {
    const record = promptTextRun.records.find(
      (candidate) => candidate.type === "artifact",
    );
    if (!record || !("preview" in record) || !record.preview) {
      throw new Error("shared PromptText messages artifact is missing");
    }
    const node = {
      request: {
        userPrompt: record.preview.userPrompt,
      },
    } as unknown as ObservabilityRunDetailNode;

    const html = renderToStaticMarkup(
      <RunDetailUserPrompt node={node} plainText="stale fallback" />,
    );

    expect(html).toContain("Hello ");
    expect(html).toContain(">Ada</span>");
    expect(html).toContain("Nested ");
    expect(html).toContain(">値</span>");
    expect(html).toContain("static · 5");
    expect(html).toContain("dynamic · 7");
    expect(html).toContain("total · 10");
    expect(html).not.toContain("stale fallback");
  });
});
