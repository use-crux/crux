import { describe, expect, it } from "vitest";
import {
  assertNoRetainedMediaSecrets,
  projectMediaRunView,
} from "./media-run-projection";

describe("media run projection", () => {
  it("projects native image summary, descriptors, and lineage", () => {
    const view = projectMediaRunView(
      [
        {
          type: "span:start",
          spanId: "span_media",
          primitive: "media.generate_image",
          name: "generate_image gpt-image-1",
          attributes: {
            provider: "openai",
            model: "gpt-image-1",
            executionKind: "native",
            calls: 1,
          },
        },
        {
          type: "artifact",
          kind: "input",
          artifactId: "art_in",
          spanId: "span_media",
          preview: {
            image: {
              kind: "image",
              mediaType: "image/png",
              sizeBytes: 12,
              sourceCategory: "bytes",
              digestPrefix: "abcdef123456",
            },
          },
        },
        {
          type: "artifact",
          kind: "output",
          artifactId: "art_out",
          spanId: "span_media",
          preview: {
            images: [
              {
                kind: "image",
                mediaType: "image/png",
                sizeBytes: 24,
                sourceCategory: "bytes",
              },
            ],
          },
        },
        {
          type: "edge",
          edgeType: "derived.from",
          from: { kind: "artifact", id: "art_out" },
          to: { kind: "artifact", id: "art_in" },
        },
        {
          type: "span:end",
          spanId: "span_media",
          status: "ok",
          durationMs: 42,
          attributes: { executionKind: "native", calls: 1, status: "ok" },
        },
      ],
      { catalogJoinId: "media.operation:cover" },
    );

    expect(view?.summary).toMatchObject({
      primitive: "media.generate_image",
      provider: "openai",
      model: "gpt-image-1",
      executionKind: "native",
      calls: 1,
      durationMs: 42,
      status: "ok",
    });
    expect(view?.inputs).toEqual([
      expect.objectContaining({
        kind: "image",
        mediaType: "image/png",
        sourceCategory: "bytes",
      }),
    ]);
    expect(view?.lineage.edges).toEqual([
      expect.objectContaining({ type: "derived.from" }),
    ]);
    expect(view?.catalogJoin).toEqual({
      status: "joined",
      definitionId: "media.operation:cover",
      label: "Catalog media operation",
    });
    expect(assertNoRetainedMediaSecrets(view)).toEqual([]);
  });

  it("normalizes legacy data-url and rejects arbitrary sourceCategory tokens", () => {
    const view = projectMediaRunView([
      {
        type: "span:start",
        spanId: "span_media",
        primitive: "media.generate_image",
        name: "generate_image",
      },
      {
        type: "artifact",
        kind: "input",
        artifactId: "art_in",
        spanId: "span_media",
        preview: {
          items: [
            {
              kind: "image",
              mediaType: "image/png",
              sourceCategory: "data-url",
            },
            {
              kind: "file",
              mediaType: "application/pdf",
              sourceCategory: "arbitrary-locator",
            },
            {
              kind: "image",
              mediaType: "image/webp",
              sourceCategory: "data",
            },
          ],
        },
      },
      {
        type: "span:end",
        spanId: "span_media",
        status: "ok",
      },
    ]);

    expect(view?.inputs).toEqual([
      { kind: "image", mediaType: "image/png", sourceCategory: "data" },
      {
        kind: "file",
        mediaType: "application/pdf",
        sourceCategory: "unknown",
      },
      { kind: "image", mediaType: "image/webp", sourceCategory: "data" },
    ]);
    expect(JSON.stringify(view?.inputs)).not.toContain("data-url");
    expect(JSON.stringify(view?.inputs)).not.toContain("arbitrary-locator");
  });

  it("shows local transcript segments and production absence", () => {
    const local = projectMediaRunView([
      {
        type: "span:start",
        spanId: "span_t",
        primitive: "media.transcribe",
        name: "transcribe whisper-1",
      },
      {
        type: "artifact",
        kind: "output",
        artifactId: "out",
        preview: {
          text: "hello speaker",
          segments: [
            { start: 0, end: 1, text: "hello", speaker: "A" },
            { start: 1, end: 2, text: "speaker", speaker: "B" },
          ],
        },
      },
      { type: "span:end", spanId: "span_t", status: "ok", durationMs: 10 },
    ]);
    expect(local?.transcript).toEqual({
      present: true,
      reason: "local-capture",
      segments: [
        { start: 0, end: 1, text: "hello", speaker: "A" },
        { start: 1, end: 2, text: "speaker", speaker: "B" },
      ],
    });

    const exported = projectMediaRunView(
      [
        {
          type: "span:start",
          spanId: "span_t",
          primitive: "media.transcribe",
          name: "transcribe whisper-1",
        },
        {
          type: "artifact",
          kind: "output",
          artifactId: "out",
          preview: { text: "hello speaker" },
        },
        { type: "span:end", spanId: "span_t", status: "ok" },
      ],
      { exportMode: true },
    );
    expect(exported?.transcript).toEqual({
      present: false,
      reason: "export-absent",
      segments: [],
    });
  });

  it("projects composed/fallback attempt timelines", () => {
    const view = projectMediaRunView([
      {
        type: "span:start",
        spanId: "span_parent",
        primitive: "media.transcribe",
        name: "transcribe gemini",
        attributes: {
          executionKind: "composed",
          calls: 1,
          provider: "google",
          model: "gemini-2.5-flash",
        },
      },
      {
        type: "span:start",
        spanId: "span_child",
        parentSpanId: "span_parent",
        primitive: "generation.call",
        name: "generation.call",
        attributes: { provider: "google", model: "gemini-2.5-flash" },
      },
      {
        type: "span:end",
        spanId: "span_child",
        status: "ok",
        durationMs: 5,
      },
      {
        type: "span:end",
        spanId: "span_parent",
        status: "ok",
        durationMs: 9,
        attributes: { executionKind: "composed", calls: 1 },
      },
    ]);
    expect(view?.attempts.map((attempt) => attempt.primitive)).toEqual([
      "media.transcribe",
      "generation.call",
    ]);
    expect(view?.attempts[1]?.parentSpanId).toBe("span_parent");
    expect(view?.attempts[0]).toMatchObject({
      provider: "google",
      model: "gemini-2.5-flash",
    });
    expect(view?.attempts[1]).toMatchObject({
      provider: "google",
      model: "gemini-2.5-flash",
      parentSpanId: "span_parent",
    });
  });

  it("projects complete safe lineage with page/time attribution and edge types", () => {
    const view = projectMediaRunView(
      [
        {
          type: "span:start",
          spanId: "span_media",
          primitive: "media.describe",
          name: "describe gpt-4o",
          attributes: {
            provider: "openai",
            model: "gpt-4o",
            executionKind: "native",
            calls: 1,
          },
        },
        {
          type: "artifact",
          kind: "input",
          artifactId: "art_in",
          spanId: "span_media",
          preview: {
            file: {
              kind: "file",
              mediaType: "application/pdf",
              pageCount: 4,
              sourceCategory: "bytes",
            },
          },
        },
        {
          type: "artifact",
          kind: "output",
          artifactId: "art_out",
          spanId: "span_media",
          preview: {
            text: "page summary",
            pageNumber: 2,
          },
        },
        {
          type: "edge",
          edgeType: "consumed",
          from: { kind: "span", id: "span_media" },
          to: { kind: "artifact", id: "art_in" },
        },
        {
          type: "edge",
          edgeType: "produced",
          from: { kind: "span", id: "span_media" },
          to: { kind: "artifact", id: "art_out" },
        },
        {
          type: "edge",
          edgeType: "derived.from",
          from: { kind: "artifact", id: "art_out" },
          to: { kind: "artifact", id: "art_in" },
          attributes: {
            location: { type: "page", pageNumber: 2 },
          },
        },
        {
          type: "span:start",
          spanId: "span_ingest",
          parentSpanId: "span_media",
          primitive: "ingest.parse",
          name: "ingest.parse",
        },
        {
          type: "edge",
          edgeType: "called",
          from: { kind: "span", id: "span_media" },
          to: { kind: "span", id: "span_ingest" },
        },
        {
          type: "span:end",
          spanId: "span_ingest",
          status: "ok",
          durationMs: 3,
        },
        {
          type: "span:start",
          spanId: "span_index",
          parentSpanId: "span_media",
          primitive: "indexing.pipeline",
          name: "indexing.pipeline",
        },
        {
          type: "edge",
          edgeType: "called",
          from: { kind: "span", id: "span_ingest" },
          to: { kind: "span", id: "span_index" },
        },
        {
          type: "span:end",
          spanId: "span_index",
          status: "ok",
          durationMs: 4,
        },
        {
          type: "span:start",
          spanId: "span_retrieve",
          parentSpanId: "span_media",
          primitive: "retrieval.query",
          name: "docs.retrieve",
        },
        {
          type: "artifact",
          kind: "retrieval.hits",
          artifactId: "art_hits",
          spanId: "span_retrieve",
          preview: {
            kind: "retrieval.hits",
            query: "policy",
            returned: 1,
            hits: [
              {
                rank: 1,
                source: {
                  id: "doc-1",
                  url: "https://example.com/SECRET_URL.pdf",
                  path: "/private/SECRET.pdf",
                  assetRef: { uri: "asset://SECRET" },
                  mediaType: "application/pdf",
                  location: { type: "time", unit: "seconds", start: 1.5, end: 3 },
                },
                chunkId: "c1",
                preview: "chunk text",
              },
            ],
          },
        },
        {
          type: "edge",
          edgeType: "retrieval.returned",
          from: { kind: "span", id: "span_retrieve" },
          to: { kind: "artifact", id: "art_hits" },
        },
        {
          type: "span:end",
          spanId: "span_retrieve",
          status: "ok",
          durationMs: 6,
        },
        {
          type: "span:end",
          spanId: "span_media",
          status: "ok",
          durationMs: 20,
          attributes: { executionKind: "native", calls: 1 },
        },
      ],
      { catalogJoinId: "media.operation:describe-pdf" },
    );

    expect(
      [...new Set(view?.lineage.nodes.map((node) => node.kind) ?? [])].sort(),
    ).toEqual(
      [
        "catalog",
        "index",
        "ingest",
        "input",
        "operation",
        "output",
        "retrieval",
      ].sort(),
    );

    const inputNode = view?.lineage.nodes.find((node) => node.kind === "input");
    expect(inputNode?.attribution).toEqual({ type: "pages", pageCount: 4 });

    const outputNode = view?.lineage.nodes.find((node) => node.kind === "output");
    expect(outputNode?.attribution).toEqual({ type: "page", pageNumber: 2 });

    const derived = view?.lineage.edges.find(
      (edge) => edge.type === "derived.from",
    );
    expect(derived).toMatchObject({
      from: "art_out",
      to: "art_in",
      type: "derived.from",
      attribution: { type: "page", pageNumber: 2 },
    });

    const retrievalNode = view?.lineage.nodes.find(
      (node) => node.kind === "retrieval",
    );
    expect(retrievalNode?.attribution).toEqual({
      type: "time",
      start: 1.5,
      end: 3,
    });
    expect(retrievalNode?.label).toBe("retrieval.query");

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
    expect(
      view?.lineage.edges.find((edge) => edge.type === "retrieval.returned"),
    ).toMatchObject({
      from: "span_retrieve",
      to: "art_hits",
      type: "retrieval.returned",
    });
    expect(
      view?.lineage.nodes.some(
        (node) =>
          node.kind === "retrieval" &&
          node.attribution?.type === "time" &&
          node.attribution.start === 1.5,
      ),
    ).toBe(true);

    expect(view?.catalogJoin).toEqual({
      status: "joined",
      definitionId: "media.operation:describe-pdf",
      label: "Catalog media operation",
    });
    // Privacy: no locators, filenames, raw refs, or media ids rendered into the model.
    expect(assertNoRetainedMediaSecrets(view)).toEqual([]);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("asset://");
    expect(serialized).not.toContain("/private/");
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("doc-1");
    expect(serialized).not.toContain("c1");
  });

  it("projects empty lineage and error attempt status accessibly", () => {
    const view = projectMediaRunView([
      {
        type: "span:start",
        spanId: "span_fail",
        primitive: "media.generate_image",
        name: "generate_image gpt-image-1",
        attributes: {
          provider: "openai",
          model: "gpt-image-1",
          executionKind: "unknown",
        },
      },
      {
        type: "span:end",
        spanId: "span_fail",
        status: "error",
        durationMs: 2,
        attributes: { status: "error" },
      },
    ]);

    expect(view?.summary.status).toBe("error");
    expect(view?.summary.executionKind).toBe("unknown");
    expect(view?.lineage.nodes).toEqual([
      expect.objectContaining({ kind: "operation", label: "media.generate_image" }),
    ]);
    expect(view?.lineage.edges).toEqual([]);
    expect(view?.attempts[0]?.status).toBe("error");
    expect(view?.inputs).toEqual([]);
    expect(view?.outputs).toEqual([]);
    // No exact Catalog definition identity on completed-media spans today.
    expect(view?.catalogJoin).toEqual({
      status: "unavailable",
      reason: "missing-runtime-join",
    });
  });

  it("selects the exact media span and scopes attempts when multiple media ops exist", () => {
    const records = [
      {
        type: "span:start",
        spanId: "span_ingest",
        primitive: "ingest.parse",
        name: "ingest.parse",
      },
      {
        type: "span:start",
        spanId: "span_describe",
        parentSpanId: "span_ingest",
        primitive: "media.describe",
        name: "describe",
        attributes: { provider: "openai", model: "gpt-4o" },
      },
      {
        type: "span:start",
        spanId: "span_gen",
        parentSpanId: "span_describe",
        primitive: "generation.call",
        name: "generation.call",
      },
      {
        type: "span:start",
        spanId: "span_transcribe",
        parentSpanId: "span_ingest",
        primitive: "media.transcribe",
        name: "transcribe",
      },
      {
        type: "artifact",
        kind: "output",
        artifactId: "art_other",
        spanId: "span_transcribe",
        preview: { text: "other transcript" },
      },
      {
        type: "span:start",
        spanId: "span_index",
        parentSpanId: "span_ingest",
        primitive: "indexing.pipeline",
        name: "indexing.pipeline",
      },
      {
        type: "edge",
        edgeType: "called",
        from: { kind: "span", id: "span_describe" },
        to: { kind: "span", id: "span_index" },
      },
      { type: "span:end", spanId: "span_gen", status: "ok" },
      { type: "span:end", spanId: "span_describe", status: "ok", durationMs: 5 },
      { type: "span:end", spanId: "span_transcribe", status: "ok" },
      { type: "span:end", spanId: "span_index", status: "ok" },
      { type: "span:end", spanId: "span_ingest", status: "ok" },
    ] as const;

    const first = projectMediaRunView(records);
    expect(first?.summary.primitive).toBe("media.describe");

    const selected = projectMediaRunView(records, {
      selectedSpanId: "span_describe",
    });
    expect(selected?.summary.primitive).toBe("media.describe");
    expect(selected?.attempts.map((a) => a.spanId)).toEqual([
      "span_describe",
      "span_gen",
    ]);
    expect(selected?.lineage.nodes.some((n) => n.id === "span_ingest")).toBe(
      true,
    );
    expect(selected?.lineage.nodes.some((n) => n.id === "span_index")).toBe(
      true,
    );
    expect(selected?.lineage.nodes.some((n) => n.id === "span_transcribe")).toBe(
      false,
    );
    expect(JSON.stringify(selected)).not.toContain("other transcript");

    const other = projectMediaRunView(records, {
      selectedSpanId: "span_transcribe",
    });
    expect(other?.summary.primitive).toBe("media.transcribe");
    expect(other?.attempts.map((a) => a.spanId)).toEqual(["span_transcribe"]);
    expect(other?.lineage.nodes.some((n) => n.id === "span_index")).toBe(false);
  });

  it("joins Catalog only from exact recorded definition identity", () => {
    const joined = projectMediaRunView([
      {
        type: "span:start",
        spanId: "span_media",
        primitive: "media.generate_image",
        name: "generate_image gpt-image-1",
        attributes: {
          provider: "openai",
          model: "gpt-image-1",
          definitionId: "media.operation:cover",
          definitionName: "cover",
        },
      },
      { type: "span:end", spanId: "span_media", status: "ok", durationMs: 1 },
    ]);
    expect(joined?.catalogJoin).toEqual({
      status: "joined",
      definitionId: "media.operation:cover",
      label: "cover",
    });
    expect(
      joined?.lineage.nodes.some(
        (node) => node.kind === "catalog" && node.label === "catalog",
      ),
    ).toBe(true);

    // operation name alone is not a Catalog definition identity.
    const byOperationOnly = projectMediaRunView([
      {
        type: "span:start",
        spanId: "span_media",
        primitive: "media.generate_image",
        attributes: { operation: "generateImage", provider: "openai" },
      },
      { type: "span:end", spanId: "span_media", status: "ok" },
    ]);
    expect(byOperationOnly?.catalogJoin).toEqual({
      status: "unavailable",
      reason: "missing-runtime-join",
    });
  });
});
