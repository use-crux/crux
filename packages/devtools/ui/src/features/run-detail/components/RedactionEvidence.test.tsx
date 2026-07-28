import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AffectedTelemetry,
  RedactionBadge,
  RedactionDot,
  RedactedArtifactRows,
} from "./RedactionEvidence";

const evidence = {
  applied: true,
  surfaces: ["artifact.preview", "error.message"],
} as const;

describe("RedactionEvidence", () => {
  it("renders the binding badge and privacy-safe tooltip", () => {
    const html = renderToStaticMarkup(<RedactionBadge evidence={evidence} />);

    expect(html).toContain("Redacted");
    expect(html).toContain(
      "Configured patterns changed captured telemetry here.",
    );
    expect(html).not.toMatch(/pattern:|replacement|value|count/i);
  });

  it("renders affected telemetry labels without counts or policy details", () => {
    const html = renderToStaticMarkup(
      <AffectedTelemetry evidence={evidence} />,
    );

    expect(html).toContain("Affected telemetry");
    expect(html).toContain("Artifact preview");
    expect(html).toContain("Error message");
    expect(html).not.toMatch(/2 surfaces|matches|rules|replacement/i);
  });

  it("omits absent evidence and renders a count-free tree dot", () => {
    expect(renderToStaticMarkup(<RedactionBadge />)).toBe("");
    const html = renderToStaticMarkup(<RedactionDot descendant />);
    expect(html).toContain(
      "Configured patterns changed captured telemetry here.",
    );
    expect(html).not.toMatch(/\\d/);
  });

  it("renders evidence beside only affected artifacts", () => {
    const html = renderToStaticMarkup(
      <RedactedArtifactRows
        artifacts={[
          {
            artifactId: "affected",
            kind: "output",
            redaction: evidence,
          },
          {
            artifactId: "old",
            kind: "input",
            preview: "[REDACTED]",
          },
        ] as never}
      />,
    );

    expect(html).toContain("output");
    expect(html).toContain("Redacted");
    expect(html).not.toContain("input");
  });
});
