import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import { projectMediaRunFromNode } from "./media-run-from-node";
import { assertNoRetainedMediaSecrets } from "./media-run-projection";

function mediaNode(): ObservabilityRunDetailNode {
  return {
    id: "node_media",
    spanId: "span_media",
    parentId: "root",
    path: ["root", "node_media"],
    virtual: false,
    kind: "span",
    primitive: "media.transcribe",
    name: "transcribe whisper-1",
    status: "ok",
    provider: "openai",
    model: "whisper-1",
    attributes: { executionKind: "composed", calls: 1 },
    display: { label: "transcribe whisper-1", tone: "warn" },
    timing: { durationMs: 12 },
    metricBuckets: {},
    source: { placementReason: "primary" },
    details: [],
    artifacts: [
      {
        artifactId: "art_out",
        runId: "run_1",
        traceId: "t",
        spanId: "span_media",
        kind: "output",
        createdAt: "2026-07-12T00:00:00.000Z",
        contentType: "application/json",
        encoding: "json",
        sizeBytes: 1,
        hash: "h",
        uri: "",
        preview: {
          text: "hello",
          segments: [{ start: 0, end: 1, text: "hello", speaker: "A" }],
        },
      },
      {
        artifactId: "art_report",
        runId: "run_1",
        traceId: "t",
        spanId: "span_media",
        kind: "media.report",
        createdAt: "2026-07-12T00:00:00.000Z",
        contentType: "application/json",
        encoding: "json",
        sizeBytes: 1,
        hash: "h",
        uri: "",
        preview: {
          kind: "audio",
          segments: 1,
          execution: { kind: "composed", calls: 1 },
        },
      },
    ],
    events: [],
    relations: [],
    diagnostics: [],
    children: [
      {
        id: "node_child",
        spanId: "span_child",
        parentId: "node_media",
        path: ["root", "node_media", "node_child"],
        virtual: false,
        kind: "span",
        primitive: "generation.call",
        name: "generation.call",
        status: "ok",
        display: { label: "generation.call", tone: "warn" },
        timing: { durationMs: 5 },
        metricBuckets: {},
        source: { placementReason: "primary" },
        details: [],
        artifacts: [],
        events: [],
        relations: [],
        diagnostics: [],
        children: [],
      },
    ],
  } as unknown as ObservabilityRunDetailNode;
}

describe("projectMediaRunFromNode", () => {
  it("projects a mounted media span tree into the Runs media view", () => {
    const view = projectMediaRunFromNode(mediaNode());
    expect(view?.summary.primitive).toBe("media.transcribe");
    expect(view?.summary.provider).toBe("openai");
    expect(view?.attempts.map((a) => a.primitive)).toEqual([
      "media.transcribe",
      "generation.call",
    ]);
    expect(view?.transcript.present).toBe(true);
    expect(assertNoRetainedMediaSecrets(view)).toEqual([]);
  });

  it("ignores non-media nodes", () => {
    const node = mediaNode();
    (node as { primitive: string }).primitive = "generation.call";
    expect(projectMediaRunFromNode(node)).toBeUndefined();
  });
});
