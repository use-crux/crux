import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import {
  formatRedactionSurfaces,
  hasLocalRedaction,
  redactionTreeState,
} from "./redaction-evidence";

function node(
  id: string,
  options: {
    redaction?: ObservabilityRunDetailNode["redaction"];
    children?: ObservabilityRunDetailNode[];
    preview?: unknown;
  } = {},
): ObservabilityRunDetailNode {
  return {
    id,
    spanId: id,
    redaction: options.redaction,
    attributes: { output: "[REDACTED]" },
    artifacts: options.preview === undefined
      ? []
      : [{ artifactId: `${id}:artifact`, preview: options.preview }],
    details: [],
    children: options.children ?? [],
  } as unknown as ObservabilityRunDetailNode;
}

describe("run-detail redaction evidence", () => {
  it("formats the closed surface vocabulary with human labels", () => {
    expect(
      formatRedactionSurfaces({
        applied: true,
        surfaces: [
          "artifact.preview",
          "artifact.uri",
          "attributes",
          "error.message",
        ],
      }),
    ).toEqual([
      "Artifact preview",
      "Artifact URI",
      "Attributes",
      "Error message",
    ]);
  });

  it("never infers evidence from replacement-looking payload text", () => {
    const replacementOnly = node("replacement-only", {
      preview: "[REDACTED]",
    });

    expect(hasLocalRedaction(replacementOnly)).toBe(false);
    expect(redactionTreeState(replacementOnly)).toEqual({
      local: false,
      descendant: false,
    });
  });

  it("computes a count-free descendant marker for collapsed ancestors", () => {
    const affected = node("affected", {
      redaction: { applied: true, surfaces: ["attributes"] },
    });
    const parent = node("parent", { children: [affected] });

    expect(redactionTreeState(affected)).toEqual({
      local: true,
      descendant: false,
    });
    expect(redactionTreeState(parent)).toEqual({
      local: false,
      descendant: true,
    });
  });
});
