import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EvidenceInspectorSummary } from "./EvidenceInspectorSummary";

vi.mock("./useEvidenceInspection", () => ({
  useEvidenceSummary: () => ({
    result: {
      subject: { kind: "execution", id: "span_subject" },
      roles: {
        intent: role("intent", "present"),
        authority: role("authority", "not-configured"),
        change: role("change", "not-applicable"),
        verification: role("verification", "present", true),
        recovery: role("recovery", "not-yet-recorded"),
      },
    },
    loading: false,
    error: null,
  }),
}));

describe("EvidenceInspectorSummary", () => {
  it("shows every canonical role aggregate without deriving a false count", () => {
    const html = renderToStaticMarkup(
      <EvidenceInspectorSummary
        subject={{ kind: "execution", id: "span_subject" }}
        onOpen={() => undefined}
      />,
    );

    for (const label of [
      "Intent",
      "Authority",
      "Change",
      "Verification",
      "Recovery",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("present");
    expect(html).toContain("not-configured");
    expect(html).toContain("not-applicable");
    expect(html).toContain("not-yet-recorded");
    expect(html).toContain("present · conflict");
    expect(html).not.toMatch(/present · 1/);
  });
});

function role(
  name: string,
  status: string,
  conflicting = false,
) {
  return {
    role: name,
    status,
    records: [{ hiddenByPagination: true }],
    conflicting,
    truncated: false,
  };
}
