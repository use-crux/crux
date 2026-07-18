import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewRunReference } from "./ReviewRunReference";

describe("ReviewRunReference", () => {
  it("keeps pending run provenance visible without linking to missing evidence", () => {
    const markup = renderToStaticMarkup(
      <ReviewRunReference
        runId="run-missing"
        contextStatus="pending"
        onOpen={() => undefined}
      />,
    );

    expect(markup).toContain("run-missing");
    expect(markup).toContain("Run evidence unavailable locally");
    expect(markup).not.toContain("<button");
  });

  it("links a run once Review context proves that Local resolved it", () => {
    const markup = renderToStaticMarkup(
      <ReviewRunReference
        runId="run-linked"
        contextStatus="linked"
        onOpen={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Open observed run run-linked"');
  });
});
