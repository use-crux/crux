import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MediaRunView } from "../lib/media-run-projection";
import { assertNoRetainedMediaSecrets } from "../lib/media-run-projection";
import { resolveMediaCatalogJoin } from "../lib/media-run-catalog-join";
import { MediaRunPanel } from "./MediaRunPanel";

const SECRET_DEFINITION_ID = "media.operation:SECRET_CUSTOMER_ID";

function baseView(overrides: Partial<MediaRunView> = {}): MediaRunView {
  return {
    summary: {
      primitive: "media.describe",
      provider: "openai",
      model: "gpt-4o",
      executionKind: "native",
      status: "ok",
      durationMs: 12,
    },
    inputs: [
      {
        kind: "file",
        mediaType: "application/pdf",
        pageCount: 4,
        sourceCategory: "bytes",
      },
    ],
    outputs: [],
    attempts: [
      {
        spanId: "span_parent",
        primitive: "media.transcribe",
        name: "transcribe gemini",
        status: "ok",
        provider: "google",
        model: "gemini-2.5-flash",
        durationMs: 9,
      },
      {
        spanId: "span_child",
        primitive: "generation.call",
        name: "generation.call",
        status: "ok",
        parentSpanId: "span_parent",
        provider: "google",
        model: "gemini-2.5-flash",
        durationMs: 5,
      },
    ],
    transcript: {
      present: false,
      reason: "not-transcription",
      segments: [],
    },
    lineage: {
      nodes: [
        {
          id: "art_in",
          kind: "input",
          label: "input",
          attribution: { type: "pages", pageCount: 4 },
        },
        { id: "span_media", kind: "operation", label: "media.describe" },
        {
          id: "art_out",
          kind: "output",
          label: "output",
          attribution: { type: "page", pageNumber: 2 },
        },
        {
          id: "span_retrieve",
          kind: "retrieval",
          label: "retrieval.query",
          attribution: { type: "time", start: 1.5, end: 3 },
        },
        { id: "catalog", kind: "catalog", label: "catalog" },
      ],
      edges: [
        { from: "span_media", to: "art_in", type: "consumed" },
        { from: "span_media", to: "art_out", type: "produced" },
        {
          from: "art_out",
          to: "art_in",
          type: "derived.from",
          attribution: { type: "page", pageNumber: 2 },
        },
        { from: "span_media", to: "span_retrieve", type: "called" },
      ],
    },
    catalogJoin: {
      status: "joined",
      definitionId: "media.operation:describe-pdf",
      label: "Describe PDF",
    },
    ...overrides,
  };
}

describe("MediaRunPanel", () => {
  it("renders attempt composition, lineage edges, and page/time attribution", () => {
    const html = renderToStaticMarkup(<MediaRunPanel view={baseView()} />);

    expect(html).toContain('aria-label="Attempt timeline"');
    expect(html).toContain("media.transcribe");
    expect(html).toContain("generation.call");
    expect(html).toContain("google");
    expect(html).toContain("gemini-2.5-flash");
    // Child composition is visibly nested / parent-linked, not a flat status list.
    expect(html).toMatch(/child of media\.transcribe|↳|nested|parent/i);

    expect(html).toContain('aria-label="Media lineage"');
    expect(html).toContain("derived.from");
    expect(html).toContain("consumed");
    expect(html).toContain("produced");
    expect(html).toContain("page 2");
    expect(html).toContain("4 pages");
    expect(html).toContain("1.5–3s");
    // Human Catalog join copy only — never the raw definition id.
    expect(html).toMatch(/Catalog source/i);
    expect(html).toContain("Describe PDF");
    expect(html).not.toContain("media.operation:describe-pdf");

    expect(assertNoRetainedMediaSecrets(html)).toEqual([]);
    expect(html).not.toMatch(/<img|<audio|<video|blob:|data:|asset:\/\//i);
  });

  it("nests attempts at arbitrary parent depth", () => {
    const html = renderToStaticMarkup(
      <MediaRunPanel
        view={baseView({
          attempts: [
            {
              spanId: "root",
              primitive: "media.transcribe",
              name: "media.transcribe",
              status: "ok",
              provider: "google",
              model: "gemini",
            },
            {
              spanId: "mid",
              primitive: "generation.call",
              name: "generation.call",
              status: "ok",
              parentSpanId: "root",
              provider: "google",
              model: "gemini",
            },
            {
              spanId: "leaf",
              primitive: "generation.stream",
              name: "generation.stream",
              status: "ok",
              parentSpanId: "mid",
              provider: "google",
              model: "gemini",
            },
          ],
        })}
      />,
    );
    expect(html).toContain("child of media.transcribe");
    expect(html).toContain("child of generation.call");
    // Depth-2 nesting is visibly deeper than depth-1 (padding/indent class).
    expect(html).toMatch(/pl-6|depth-2|padding-left:\s*1\.5rem|style="[^"]*padding-left:\s*24px/i);
  });

  it("renders Catalog join without exposing definition ids", () => {
    const joined = renderToStaticMarkup(<MediaRunPanel view={baseView()} />);
    expect(joined).toMatch(/Catalog source/i);
    expect(joined).toContain("Describe PDF");
    expect(joined).not.toContain("media.operation:");
    expect(joined).not.toContain("media.operation:describe-pdf");

    const unavailable = renderToStaticMarkup(
      <MediaRunPanel
        view={baseView({
          catalogJoin: {
            status: "unavailable",
            reason: "missing-runtime-join",
          },
        })}
      />,
    );
    expect(unavailable).toMatch(/Catalog source join unavailable/i);
    expect(unavailable).toContain('role="status"');
    expect(unavailable).not.toContain("media.operation:");
  });

  it("never renders a secret definition id when no display name was recorded", () => {
    const catalogJoin = resolveMediaCatalogJoin({
      definitionId: SECRET_DEFINITION_ID,
    });
    const html = renderToStaticMarkup(
      <MediaRunPanel view={baseView({ catalogJoin })} />,
    );

    expect(html).toContain("Catalog media operation");
    expect(html).not.toContain("SECRET");
    expect(html).not.toContain("SECRET_CUSTOMER_ID");
    expect(html).not.toContain("media.operation:");
  });

  it("renders accessible empty and error states", () => {
    const html = renderToStaticMarkup(
      <MediaRunPanel
        view={baseView({
          summary: {
            primitive: "media.generate_image",
            executionKind: "unknown",
            status: "error",
            provider: "openai",
            model: "gpt-image-1",
          },
          inputs: [],
          outputs: [],
          attempts: [
            {
              spanId: "span_fail",
              primitive: "media.generate_image",
              name: "generate_image gpt-image-1",
              status: "error",
              provider: "openai",
              model: "gpt-image-1",
            },
          ],
          lineage: { nodes: [], edges: [] },
          catalogJoin: {
            status: "unavailable",
            reason: "missing-runtime-join",
          },
        })}
      />,
    );

    expect(html).toContain("unknown");
    expect(html).toContain("error");
    expect(html).toContain("No descriptors");
    expect(html).toMatch(/no lineage|lineage is empty|no relationships/i);
    expect(html).toContain('role="status"');
  });
});
