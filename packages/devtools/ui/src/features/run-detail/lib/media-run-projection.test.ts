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
    expect(view?.catalogJoinId).toBe("media.operation:cover");
    expect(assertNoRetainedMediaSecrets(view)).toEqual([]);
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
        attributes: { executionKind: "composed", calls: 1 },
      },
      {
        type: "span:start",
        spanId: "span_child",
        parentSpanId: "span_parent",
        primitive: "generation.call",
        name: "generation.call",
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
  });
});
