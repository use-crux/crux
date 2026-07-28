import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import {
  AffectedTelemetry,
  RedactionBadge,
  RedactionDot,
  RedactedArtifactRows,
} from "./RedactionEvidence";

type RunDetailArtifact = ObservabilityRunDetailNode["artifacts"][number];

const evidence = {
  applied: true,
  surfaces: ["artifact.preview", "error.message"],
} as const;

const baseArtifact = {
  artifactId: "artifact" as RunDetailArtifact["artifactId"],
  runId: "run" as RunDetailArtifact["runId"],
  traceId: "",
  spanId: "",
  kind: "output",
  createdAt: "2026-07-28T00:00:00.000Z",
  contentType: "text/plain",
  encoding: "text",
  sizeBytes: 0,
  hash: "",
  uri: "",
} satisfies RunDetailArtifact;

function artifact(
  overrides: Partial<RunDetailArtifact>,
): RunDetailArtifact {
  return { ...baseArtifact, ...overrides };
}

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
    const text = html.replaceAll(/<[^>]*>/g, "");
    expect(text).not.toMatch(/\d/);
  });

  it("renders evidence beside only affected artifacts", () => {
    const html = renderToStaticMarkup(
      <RedactedArtifactRows
        artifacts={[
          artifact({
            artifactId: "affected" as RunDetailArtifact["artifactId"],
            kind: "output",
            redaction: evidence,
          }),
          artifact({
            artifactId: "old" as RunDetailArtifact["artifactId"],
            kind: "input",
            preview: "[REDACTED]",
          }),
        ]}
      />,
    );

    expect(html).toContain("output");
    expect(html).toContain("Redacted");
    expect(html).not.toContain("input");
  });
});
