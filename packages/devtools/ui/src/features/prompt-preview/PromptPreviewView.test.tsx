import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PromptPreviewContent } from "./PromptPreviewView";
import type { PromptPreviewWorkflowState } from "./types";

describe("Prompt preview page", () => {
  it("renders the exact confirmation and all runtime tuple fields", () => {
    const state: PromptPreviewWorkflowState = {
      phase: "input",
      rawText: "{}",
      canPreview: false,
      discovery: {
        status: "ready",
        projectionRevision: 3,
        owner: {
          definitionId: "prompt:writer",
          kind: "prompt",
          name: "Writer",
        },
        choices: [
          {
            peerId: "peer-a",
            runtimeName: "App",
            environment: "node",
            catalogueRevision: 7,
            target: { name: "Writer", input: { mode: "raw" } },
          },
          {
            peerId: "peer-b",
            runtimeName: "App",
            environment: "serverless",
            catalogueRevision: 8,
            target: { name: "Writer", input: { mode: "raw" } },
          },
        ],
      },
    };
    const html = renderToStaticMarkup(
      <PromptPreviewContent
        state={state}
        onRawText={vi.fn()}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onCancel={vi.fn()}
        onFormValue={vi.fn()}
      />,
    );
    expect(html).toContain("App · node · peer-a · catalogue 7");
    expect(html).toContain("App · serverless · peer-b · catalogue 8");
    expect(html).toContain(
      "Preview runs canonical inspection in the selected application runtime. Trusted refinements, transforms, prompt and context callbacks, retrieval, memory, and memo callbacks may perform side effects or I/O. It does not invoke a model provider or tool and creates no ordinary Run.",
    );
  });

  it("renders the frozen deleted-owner message as one statement", () => {
    const html = renderToStaticMarkup(
      <PromptPreviewContent
        state={{
          phase: "unavailable",
          rawText: "{}",
          canPreview: false,
          message:
            "This Prompt is no longer present in the current Project Index.",
          discovery: {
            status: "unavailable",
            projectionRevision: 4,
            reason: "owner-not-found",
            message:
              "This Prompt is no longer present in the current Project Index.",
          },
        }}
        onRawText={vi.fn()}
        onSelect={vi.fn()}
        onPreview={vi.fn()}
        onCancel={vi.fn()}
        onFormValue={vi.fn()}
      />,
    );
    expect(html).toContain(
      "This Prompt is no longer present in the current Project Index. Return to Catalog.",
    );
  });
});
