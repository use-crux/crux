import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PromptPreviewWorkflowState } from "../types";
import { PromptPreviewResultView } from "./view";

describe("Exact Prompt preview result", () => {
  it("renders inspection structure and keeps JSON secondary", () => {
    const state: PromptPreviewWorkflowState = {
      phase: "ready",
      rawText: "{}",
      canPreview: true,
      result: {
        status: "ready",
        peer: {
          peerId: "peer",
          runtimeName: "App",
          environment: "node",
        },
        catalogueRevision: 4,
        inspection: {
          system: {
            text: "Policy\n\nLive context",
            tokens: 5,
            coverage: "complete",
            parts: [
              {
                source: "prompt:writer",
                text: "Policy",
                tokens: 2,
                staticTokens: 2,
                dynamicTokens: 0,
                skipped: false,
                segments: [{ kind: "static", startUtf16: 0, endUtf16: 6 }],
              },
              {
                source: "context:live",
                text: "Live context",
                tokens: 3,
                staticTokens: 1,
                dynamicTokens: 2,
                skipped: false,
                segments: [
                  { kind: "static", startUtf16: 0, endUtf16: 5 },
                  {
                    kind: "dynamic",
                    startUtf16: 5,
                    endUtf16: 12,
                    source: "profile",
                  },
                ],
              },
            ],
          },
          prompt: {
            text: "Hello Ada",
            tokens: 2,
            staticTokens: 1,
            dynamicTokens: 1,
            segments: [
              { kind: "static", startUtf16: 0, endUtf16: 6 },
              {
                kind: "dynamic",
                startUtf16: 6,
                endUtf16: 9,
                source: "name",
              },
            ],
          },
          totalTokens: 7,
          tokenBudget: 12,
          droppedContexts: [
            {
              source: "context:large",
              text: "Dropped text",
              tokens: 4,
              priority: 1,
              segments: [{ kind: "unknown", startUtf16: 0, endUtf16: 12 }],
            },
          ],
          excludedContexts: [
            { source: "context:disabled", reason: "disabled" },
          ],
        },
      },
    };

    const html = renderToStaticMarkup(
      <PromptPreviewResultView state={state} />,
    );

    expect(html).toContain("Assembled system");
    expect(html).toContain("prompt:writer");
    expect(html).toContain("context:live");
    expect(html).toContain("User prompt");
    expect(html).toContain(">Ada</span>");
    expect(html).toContain("authored · 1");
    expect(html).toContain("interpolated · 1");
    expect(html).toContain("total · 7");
    expect(html).toContain("budget · 12");
    expect(html).toContain("Dropped contexts");
    expect(html).toContain("context:large");
    expect(html).toContain("Excluded contexts");
    expect(html).toContain("context:disabled");
    expect(html).toContain("Raw result JSON");
  });

  it("renders validation issues as structured findings", () => {
    const html = renderToStaticMarkup(
      <PromptPreviewResultView
        state={{
          phase: "validation-error",
          rawText: "{}",
          canPreview: true,
          result: {
            status: "validation-error",
            catalogueRevision: 4,
            issues: [
              {
                code: "invalid_type",
                path: ["profile", 0, "name"],
                message: "Expected string.",
              },
            ],
            omittedIssueCount: 2,
          },
        }}
      />,
    );

    expect(html).toContain("Validation");
    expect(html).toContain("invalid_type");
    expect(html).toContain("profile.0.name");
    expect(html).toContain("Expected string.");
    expect(html).toContain("2 additional issues omitted");
  });

  it("renders stable pending and error states", () => {
    expect(
      renderToStaticMarkup(
        <PromptPreviewResultView
          state={{
            phase: "input",
            rawText: "{}",
            canPreview: true,
          }}
        />,
      ),
    ).toContain("No preview result yet.");
    expect(
      renderToStaticMarkup(
        <PromptPreviewResultView
          state={{
            phase: "error",
            rawText: "{}",
            canPreview: true,
            message: "Runtime unavailable.",
          }}
        />,
      ),
    ).toContain("Runtime unavailable.");
  });
});
