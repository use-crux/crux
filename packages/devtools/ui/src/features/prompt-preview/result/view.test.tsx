import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PromptPreviewWorkflowState } from "../types";
import { PromptPreviewResultView } from "./view";

describe("Prompt request preview result", () => {
  it("renders fit and required, sticky, and elastic contribution boundaries", () => {
    const state: PromptPreviewWorkflowState = {
      phase: "ready",
      rawText: "{}",
      canPreview: true,
      result: {
        status: "ready",
        peer: { peerId: "peer", runtimeName: "App", environment: "node" },
        catalogueRevision: 4,
        preview: {
          status: "unknown",
          model: "provider:model",
          inputTokens: 900,
          maxInputTokens: 1_000,
          measurement: "incomplete",
          adaptations: [
            {
              contributor: "context:examples",
              representation: "summary",
              state: "unprepared",
            },
          ],
          warnings: [],
          diagnostics: [],
        },
        contributions: [
          {
            id: "prompt:writer",
            boundary: "required",
            representations: ["full"],
          },
          {
            id: "context:style",
            boundary: "sticky",
            representations: ["full", "authored", "summary"],
          },
          {
            id: "context:examples",
            boundary: "elastic",
            representations: ["full", "summary", "omitted"],
          },
        ],
      },
    };

    const html = renderToStaticMarkup(
      <PromptPreviewResultView state={state} />,
    );

    expect(html).toContain("Request preview");
    expect(html).toContain("Needs preparation");
    expect(html).toContain("Contribution map");
    expect(html).toContain("prompt:writer");
    expect(html).toContain("required");
    expect(html).toContain("context:style");
    expect(html).toContain("sticky");
    expect(html).toContain("context:examples");
    expect(html).toContain("elastic");
    expect(html).toContain("full → authored → summary");
    expect(html).toContain("summary · unprepared");
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

    expect(html).toContain("invalid_type");
    expect(html).toContain("profile.0.name");
    expect(html).toContain("2 additional issues omitted");
  });

  it("renders stable pending and error states", () => {
    expect(
      renderToStaticMarkup(
        <PromptPreviewResultView
          state={{ phase: "input", rawText: "{}", canPreview: true }}
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
