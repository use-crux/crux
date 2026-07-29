import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PromptLatestRunEmptyState } from "./empty-state";

describe("Prompt latest-Run Catalog empty state", () => {
  it("renders a coherent found state and current actions", () => {
    const html = renderToStaticMarkup(
      <PromptLatestRunEmptyState
        hasRun
        exactPreviewAvailable
        onOpenLatest={vi.fn()}
        onPreviewExact={vi.fn()}
      />,
    );

    expect(html).toContain("Captured Run available");
    expect(html).toContain(
      "Open the latest captured Run that references this Prompt.",
    );
    expect(html).not.toContain("No captured Runs yet");
    expect(html).not.toContain("No captured Run references this Prompt yet.");
    expect(html).toContain("Open latest Run");
    expect(html).toContain("Preview exact PromptText");
    expect(html).not.toContain(
      "Connect a compatible application runtime to preview exact PromptText.",
    );
  });

  it("renders the true empty state and unavailable preview help", () => {
    const onOpenLatest = vi.fn();
    const onPreviewExact = vi.fn();
    const html = renderToStaticMarkup(
      <PromptLatestRunEmptyState
        hasRun={false}
        exactPreviewAvailable={false}
        onOpenLatest={onOpenLatest}
        onPreviewExact={onPreviewExact}
      />,
    );

    expect(html).toContain(
      "Connect a compatible application runtime to preview exact PromptText.",
    );
    expect(html).toContain("No captured Runs yet");
    expect(html).toContain("No captured Run references this Prompt yet.");
    expect(html).not.toContain("Open latest Run");
    expect(onOpenLatest).not.toHaveBeenCalled();
    expect(onPreviewExact).not.toHaveBeenCalled();
  });
});
