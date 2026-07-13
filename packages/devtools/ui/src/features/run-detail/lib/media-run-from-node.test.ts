import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import { projectMediaRunFromNode } from "./media-run-from-node";
import { assertNoRetainedMediaSecrets } from "./media-run-projection";

function baseNode(fields: Record<string, unknown>): ObservabilityRunDetailNode {
  return {
    path: [fields.id],
    virtual: false,
    kind: "span",
    name: fields.primitive,
    status: "ok",
    display: { label: fields.primitive, tone: "warn" },
    timing: { durationMs: 1 },
    metricBuckets: {},
    source: { placementReason: "primary" },
    details: [],
    artifacts: [],
    events: [],
    relations: [],
    diagnostics: [],
    children: [],
    ...fields,
  } as unknown as ObservabilityRunDetailNode;
}

function mediaNode(): ObservabilityRunDetailNode {
  return baseNode({
    id: "node_media",
    spanId: "span_media",
    parentId: "root",
    path: ["root", "node_media"],
    primitive: "media.transcribe",
    name: "transcribe whisper-1",
    provider: "openai",
    model: "whisper-1",
    attributes: { executionKind: "composed", calls: 1 },
    display: { label: "transcribe whisper-1", tone: "warn" },
    timing: { durationMs: 12 },
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
    children: [
      baseNode({
        id: "node_child",
        spanId: "span_child",
        parentId: "node_media",
        path: ["root", "node_media", "node_child"],
        primitive: "generation.call",
        name: "generation.call",
        timing: { durationMs: 5 },
      }),
    ],
  });
}

/**
 * Real ingest-shaped run: media.describe is a child of ingest.parse; relation-
 * connected index/retrieval nodes sit outside the media subtree; a second media
 * branch proves exact selection and exclusion.
 */
function ingestRootWithSelectedDescribe(): {
  root: ObservabilityRunDetailNode;
  selectedMediaSpanId: string;
} {
  const selectedMediaSpanId = "span_describe";

  const describe = baseNode({
    id: "node_describe",
    spanId: selectedMediaSpanId,
    parentId: "span_ingest",
    path: ["span_ingest", "node_describe"],
    primitive: "media.describe",
    name: "describe gpt-4o",
    provider: "openai",
    model: "gpt-4o",
    attributes: { executionKind: "native", calls: 1 },
    timing: { durationMs: 20 },
    artifacts: [
      {
        artifactId: "art_in_describe",
        runId: "run_1",
        traceId: "t",
        spanId: selectedMediaSpanId,
        kind: "input",
        createdAt: "2026-07-12T00:00:00.000Z",
        contentType: "application/json",
        encoding: "json",
        sizeBytes: 1,
        hash: "h",
        uri: "",
        preview: {
          file: {
            kind: "file",
            mediaType: "application/pdf",
            pageCount: 3,
            sourceCategory: "bytes",
          },
        },
      },
      {
        artifactId: "art_out_describe",
        runId: "run_1",
        traceId: "t",
        spanId: selectedMediaSpanId,
        kind: "output",
        createdAt: "2026-07-12T00:00:00.000Z",
        contentType: "application/json",
        encoding: "json",
        sizeBytes: 1,
        hash: "h",
        uri: "",
        preview: {
          text: "page summary",
          pageNumber: 2,
        },
      },
      {
        artifactId: "art_report_describe",
        runId: "run_1",
        traceId: "t",
        spanId: selectedMediaSpanId,
        kind: "media.report",
        createdAt: "2026-07-12T00:00:00.000Z",
        contentType: "application/json",
        encoding: "json",
        sizeBytes: 1,
        hash: "h",
        uri: "",
        preview: { kind: "file", execution: { kind: "native", calls: 1 } },
      },
    ],
    relations: [
      {
        edgeId: "e_consumed",
        runId: "run_1",
        traceId: "t",
        edgeType: "consumed",
        from: { kind: "span", id: selectedMediaSpanId },
        to: { kind: "artifact", id: "art_in_describe" },
        createdAt: "2026-07-12T00:00:00.000Z",
      },
      {
        edgeId: "e_produced",
        runId: "run_1",
        traceId: "t",
        edgeType: "produced",
        from: { kind: "span", id: selectedMediaSpanId },
        to: { kind: "artifact", id: "art_out_describe" },
        createdAt: "2026-07-12T00:00:00.000Z",
      },
      {
        edgeId: "e_derived",
        runId: "run_1",
        traceId: "t",
        edgeType: "derived.from",
        from: { kind: "artifact", id: "art_out_describe" },
        to: { kind: "artifact", id: "art_in_describe" },
        createdAt: "2026-07-12T00:00:00.000Z",
        attributes: { location: { type: "page", pageNumber: 2 } },
      },
      {
        edgeId: "e_to_index",
        runId: "run_1",
        traceId: "t",
        edgeType: "called",
        from: { kind: "span", id: selectedMediaSpanId },
        to: { kind: "span", id: "span_index" },
        createdAt: "2026-07-12T00:00:00.000Z",
      },
    ],
    children: [
      baseNode({
        id: "node_gen",
        spanId: "span_gen",
        parentId: "node_describe",
        path: ["span_ingest", "node_describe", "node_gen"],
        primitive: "generation.call",
        name: "generation.call",
        provider: "openai",
        model: "gpt-4o",
        timing: { durationMs: 8 },
      }),
    ],
  });

  const otherMedia = baseNode({
    id: "node_transcribe",
    spanId: "span_transcribe",
    parentId: "span_ingest",
    path: ["span_ingest", "node_transcribe"],
    primitive: "media.transcribe",
    name: "transcribe other",
    provider: "openai",
    model: "whisper-1",
    attributes: { executionKind: "native", calls: 1 },
    timing: { durationMs: 15 },
    artifacts: [
      {
        artifactId: "art_out_other",
        runId: "run_1",
        traceId: "t",
        spanId: "span_transcribe",
        kind: "output",
        createdAt: "2026-07-12T00:00:00.000Z",
        contentType: "application/json",
        encoding: "json",
        sizeBytes: 1,
        hash: "h",
        uri: "",
        preview: {
          text: "unrelated transcript",
          segments: [{ start: 0, end: 1, text: "unrelated", speaker: "X" }],
        },
      },
    ],
  });

  const index = baseNode({
    id: "node_index",
    spanId: "span_index",
    parentId: "span_ingest",
    path: ["span_ingest", "node_index"],
    primitive: "indexing.pipeline",
    name: "indexing.pipeline",
    timing: { durationMs: 4 },
    artifacts: [
      {
        artifactId: "art_index_report",
        runId: "run_1",
        traceId: "t",
        spanId: "span_index",
        kind: "indexing.report",
        createdAt: "2026-07-12T00:00:00.000Z",
        contentType: "application/json",
        encoding: "json",
        sizeBytes: 1,
        hash: "h",
        uri: "",
        preview: { kind: "indexing.report" },
      },
    ],
    relations: [
      {
        edgeId: "e_to_retrieval",
        runId: "run_1",
        traceId: "t",
        edgeType: "called",
        from: { kind: "span", id: "span_index" },
        to: { kind: "span", id: "span_retrieve" },
        createdAt: "2026-07-12T00:00:00.000Z",
      },
    ],
  });

  const retrieve = baseNode({
    id: "node_retrieve",
    spanId: "span_retrieve",
    parentId: "span_ingest",
    path: ["span_ingest", "node_retrieve"],
    primitive: "retrieval.query",
    name: "docs.retrieve",
    timing: { durationMs: 6 },
    artifacts: [
      {
        artifactId: "art_hits",
        runId: "run_1",
        traceId: "t",
        spanId: "span_retrieve",
        kind: "retrieval.hits",
        createdAt: "2026-07-12T00:00:00.000Z",
        contentType: "application/json",
        encoding: "json",
        sizeBytes: 1,
        hash: "h",
        uri: "",
        preview: {
          kind: "retrieval.hits",
          hits: [
            {
              rank: 1,
              source: {
                location: { type: "time", unit: "seconds", start: 1.5, end: 3 },
              },
            },
          ],
        },
      },
    ],
    relations: [
      {
        edgeId: "e_hits",
        runId: "run_1",
        traceId: "t",
        edgeType: "retrieval.returned",
        from: { kind: "span", id: "span_retrieve" },
        to: { kind: "artifact", id: "art_hits" },
        createdAt: "2026-07-12T00:00:00.000Z",
      },
    ],
  });

  const unrelated = baseNode({
    id: "node_unrelated",
    spanId: "span_unrelated",
    parentId: "span_ingest",
    path: ["span_ingest", "node_unrelated"],
    primitive: "tool.call",
    name: "unrelated.tool",
    timing: { durationMs: 2 },
    artifacts: [
      {
        artifactId: "art_unrelated",
        runId: "run_1",
        traceId: "t",
        spanId: "span_unrelated",
        kind: "output",
        createdAt: "2026-07-12T00:00:00.000Z",
        contentType: "application/json",
        encoding: "json",
        sizeBytes: 1,
        hash: "h",
        uri: "",
        preview: { text: "noise" },
      },
    ],
  });

  const root = baseNode({
    id: "node_ingest",
    spanId: "span_ingest",
    parentId: "",
    path: ["span_ingest"],
    primitive: "ingest.parse",
    name: "ingest.parse",
    timing: { durationMs: 40 },
    artifacts: [
      {
        artifactId: "art_ingest_report",
        runId: "run_1",
        traceId: "t",
        spanId: "span_ingest",
        kind: "ingest.report",
        createdAt: "2026-07-12T00:00:00.000Z",
        contentType: "application/json",
        encoding: "json",
        sizeBytes: 1,
        hash: "h",
        uri: "",
        preview: { kind: "ingest.report" },
      },
    ],
    children: [describe, otherMedia, index, retrieve, unrelated],
  });

  return { root, selectedMediaSpanId };
}

describe("projectMediaRunFromNode", () => {
  it("projects a mounted media span tree into the Runs media view", () => {
    const node = mediaNode();
    const view = projectMediaRunFromNode(node, "span_media");
    expect(view?.summary.primitive).toBe("media.transcribe");
    expect(view?.summary.provider).toBe("openai");
    expect(view?.attempts.map((a) => a.primitive)).toEqual([
      "media.transcribe",
      "generation.call",
    ]);
    expect(view?.transcript.present).toBe(true);
    expect(assertNoRetainedMediaSecrets(view)).toEqual([]);
  });

  it("wires live Catalog join only from exact recorded definition identity", () => {
    // Live completed-media spans today record provider/operation/model only —
    // no Catalog definitionId — so the join is an explicit unavailable state.
    const unavailable = projectMediaRunFromNode(mediaNode(), "span_media");
    expect(unavailable?.catalogJoin).toEqual({
      status: "unavailable",
      reason: "missing-runtime-join",
    });

    const withIdentity = mediaNode();
    (withIdentity as { attributes: Record<string, unknown> }).attributes = {
      ...withIdentity.attributes,
      definitionId: "media.operation:cover",
      definitionName: "cover",
    };
    const joined = projectMediaRunFromNode(withIdentity, "span_media");
    expect(joined?.catalogJoin).toEqual({
      status: "joined",
      definitionId: "media.operation:cover",
      label: "cover",
    });
  });

  it("ignores non-media selected spans", () => {
    const node = mediaNode();
    (node as { primitive: string }).primitive = "generation.call";
    expect(projectMediaRunFromNode(node, "span_media")).toBeUndefined();
  });

  it("projects full-graph lineage from ingest root with exact media selection", () => {
    const { root, selectedMediaSpanId } = ingestRootWithSelectedDescribe();

    const view = projectMediaRunFromNode(root, selectedMediaSpanId);
    expect(view).toBeDefined();

    // Exact media selection — not first-media (transcribe) and not the root.
    expect(view?.summary.primitive).toBe("media.describe");
    expect(view?.summary.provider).toBe("openai");
    expect(view?.summary.model).toBe("gpt-4o");

    // Attempts scoped to selected media + composed child only.
    expect(view?.attempts.map((a) => a.spanId)).toEqual([
      "span_describe",
      "span_gen",
    ]);
    expect(view?.attempts.map((a) => a.primitive)).not.toContain(
      "media.transcribe",
    );
    expect(view?.attempts.map((a) => a.primitive)).not.toContain("ingest.parse");

    // Inputs/outputs/transcript scoped to selected media artifacts.
    expect(view?.inputs).toEqual([
      expect.objectContaining({
        kind: "file",
        mediaType: "application/pdf",
        pageCount: 3,
      }),
    ]);
    expect(view?.outputs).toEqual([]);
    expect(view?.transcript.present).toBe(false);
    expect(view?.transcript.reason).toBe("not-transcription");

    // Lineage: relation-connected ingest parent + downstream index/retrieval,
    // input/output/report around the selected media — not the unrelated branch.
    const kinds = [
      ...new Set(view?.lineage.nodes.map((node) => node.kind) ?? []),
    ].sort();
    expect(kinds).toEqual(
      ["index", "ingest", "input", "operation", "output", "report", "retrieval"].sort(),
    );

    expect(
      view?.lineage.nodes.some(
        (node) => node.kind === "ingest" && node.id === "span_ingest",
      ),
    ).toBe(true);
    expect(
      view?.lineage.nodes.some(
        (node) => node.kind === "index" && node.id === "span_index",
      ),
    ).toBe(true);
    expect(
      view?.lineage.nodes.some(
        (node) => node.kind === "retrieval" && node.id === "span_retrieve",
      ),
    ).toBe(true);

    const inputNode = view?.lineage.nodes.find((node) => node.kind === "input");
    expect(inputNode?.attribution).toEqual({ type: "pages", pageCount: 3 });
    const outputNode = view?.lineage.nodes.find((node) => node.kind === "output");
    expect(outputNode?.attribution).toEqual({ type: "page", pageNumber: 2 });
    const retrievalNode = view?.lineage.nodes.find(
      (node) => node.id === "art_hits" || node.id === "span_retrieve",
    );
    expect(
      view?.lineage.nodes.some(
        (node) =>
          node.kind === "retrieval" &&
          node.attribution?.type === "time" &&
          node.attribution.start === 1.5,
      ),
    ).toBe(true);
    expect(retrievalNode).toBeDefined();

    const edgeTypes = view?.lineage.edges.map((edge) => edge.type).sort();
    expect(edgeTypes).toEqual(
      expect.arrayContaining([
        "consumed",
        "produced",
        "derived.from",
        "called",
        "retrieval.returned",
      ]),
    );

    // Exclusion: second media + unrelated tool branch must not appear.
    const lineageIds = new Set(view?.lineage.nodes.map((node) => node.id));
    expect(lineageIds.has("span_transcribe")).toBe(false);
    expect(lineageIds.has("art_out_other")).toBe(false);
    expect(lineageIds.has("span_unrelated")).toBe(false);
    expect(lineageIds.has("art_unrelated")).toBe(false);
    expect(JSON.stringify(view)).not.toContain("unrelated transcript");
    expect(JSON.stringify(view)).not.toContain("span_transcribe");

    expect(assertNoRetainedMediaSecrets(view)).toEqual([]);
  });

  it("selects the other media operation when that span identity is provided", () => {
    const { root } = ingestRootWithSelectedDescribe();
    const view = projectMediaRunFromNode(root, "span_transcribe");
    expect(view?.summary.primitive).toBe("media.transcribe");
    expect(view?.attempts.map((a) => a.spanId)).toEqual(["span_transcribe"]);
    expect(view?.transcript.present).toBe(true);
    expect(view?.lineage.nodes.some((node) => node.id === "span_describe")).toBe(
      false,
    );
    expect(view?.lineage.nodes.some((node) => node.id === "span_index")).toBe(
      false,
    );
  });
});
