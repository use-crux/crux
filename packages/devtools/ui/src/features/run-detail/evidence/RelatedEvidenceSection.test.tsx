import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RelatedEvidenceSection } from "./RelatedEvidenceSection";

const useRelatedEvidence = vi.fn();
vi.mock("./useRelatedEvidence", () => ({
  useRelatedEvidence: (...args: unknown[]) => useRelatedEvidence(...args),
}));

const root = {
  id: "root",
  spanId: "root",
  name: "Root",
  children: [],
};

describe("RelatedEvidenceSection", () => {
  beforeEach(() => {
    useRelatedEvidence.mockReset();
  });

  it("renders exact showing copy only for a complete result", () => {
    useRelatedEvidence.mockReturnValue({
      result: {
        total: 12,
        showing: 8,
        rows: [
          {
            subject: { kind: "execution", id: "span_child" },
            label: "Child",
            kind: "span",
            recordCount: 3,
          },
        ],
      },
      loading: false,
      error: null,
    });
    const html = renderToStaticMarkup(
      <RelatedEvidenceSection
        root={root}
        selectedId="root"
        onSelectSubject={() => undefined}
      />,
    );
    expect(html).toContain("Showing 8 of 12 subjects with evidence");
    expect(html).toContain("Child");
  });

  it("never presents a partial failure as an exact total", () => {
    useRelatedEvidence.mockReturnValue({
      result: undefined,
      loading: false,
      error: new Error("one chunk failed"),
    });
    const html = renderToStaticMarkup(
      <RelatedEvidenceSection
        root={root}
        selectedId="root"
        onSelectSubject={() => undefined}
      />,
    );
    expect(html).toContain("an exact total cannot be shown");
    expect(html).not.toContain("Showing");
  });
});
