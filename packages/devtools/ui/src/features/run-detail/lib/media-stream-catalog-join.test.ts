import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import { projectMediaRunFromNode } from "./media-run-from-node";
import { resolveMediaCatalogJoin } from "./media-run-catalog-join";

describe("bounded media stream Catalog join", () => {
  it("uses one exact media.operation DefinitionRef from Local", () => {
    const view = projectMediaRunFromNode(
      streamNode([
        {
          id: "media.operation:narration",
          kind: "media.operation",
          role: "invoked-media-operation",
        },
      ]),
      "stream-logical",
    );

    expect(view?.catalogJoin).toEqual({
      status: "joined",
      definitionId: "media.operation:narration",
      label: "Catalog media operation",
    });
    expect(view?.lineage.nodes.some((node) => node.kind === "catalog")).toBe(
      true,
    );
  });

  it("keeps missing and wrong DefinitionRef roles unavailable", () => {
    expect(
      projectMediaRunFromNode(streamNode([]), "stream-logical")?.catalogJoin,
    ).toEqual({
      status: "unavailable",
      reason: "missing-runtime-join",
    });

    for (const definitionRefs of [
      [{ id: "media.operation:missing-role", kind: "media.operation" }],
      [
        {
          id: "media.operation:wrong-role",
          kind: "media.operation",
          role: "invoked-agent",
        },
      ],
    ]) {
      expect(
        projectMediaRunFromNode(streamNode(definitionRefs), "stream-logical")
          ?.catalogJoin,
      ).toEqual({
        status: "unavailable",
        reason: "missing-runtime-join",
      });
    }

    expect(
      resolveMediaCatalogJoin({
        definitionId: "media.operation:attribute-only",
      }),
    ).toEqual({
      status: "unavailable",
      reason: "missing-runtime-join",
    });
  });

  it("keeps conflicting valid invoked-media-operation refs ambiguous", () => {
    expect(
      resolveMediaCatalogJoin(undefined, {
        definitionRefs: [
          {
            id: "media.operation:one",
            kind: "media.operation",
            role: "invoked-media-operation",
          },
          {
            id: "media.operation:two",
            kind: "media.operation",
            role: "invoked-media-operation",
          },
        ],
      }),
    ).toEqual({
      status: "unavailable",
      reason: "ambiguous-runtime-join",
    });
  });
});

function streamNode(
  definitionRefs: readonly Readonly<{
    id: string;
    kind: string;
    role?: string;
  }>[],
): ObservabilityRunDetailNode {
  return {
    id: "stream-logical",
    spanId: "stream-logical",
    parentId: "run",
    path: ["run", "stream-logical"],
    virtual: false,
    kind: "span",
    family: "media",
    primitive: "media.generate_speech",
    name: "streamSpeech",
    status: "ok",
    runId: "run",
    traceId: "",
    parentSpanId: "",
    startedAt: "2026-07-28T12:00:00.000Z",
    endedAt: "2026-07-28T12:00:00.042Z",
    durationMs: 42,
    model: "safe-model",
    provider: "google",
    attributes: {
      operation: "streamSpeech",
      streamingRole: "logical",
      terminal: "ok",
      committed: true,
      attemptCount: 1,
    },
    definitionRefs:
      definitionRefs as unknown as ObservabilityRunDetailNode["definitionRefs"],
    display: { kind: "media", label: "streamSpeech", severity: "ok" },
    timing: { durationMs: 42 },
    metricBuckets: {},
    source: { placementReason: "primary" },
    details: [],
    artifacts: [],
    events: [],
    relations: [],
    diagnostics: [],
    children: [],
  } as unknown as ObservabilityRunDetailNode;
}
