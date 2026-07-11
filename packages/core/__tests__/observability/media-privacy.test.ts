import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxGraphRecord,
} from "../../src/observability";
import { resetHooks, updateHooks } from "../../src/runtime/runtime";
import { sanitizeMediaPreview } from "../../src/observability/media-preview";

describe("observability media privacy", () => {
  afterEach(() => {
    resetObservabilityRuntime();
    resetHooks();
  });

  it("never exposes opaque provider continuation payloads in previews", () => {
    const preview = sanitizeMediaPreview({
      type: "reasoning",
      text: "",
      providerOptions: {
        anthropic: {
          continuation: {
            type: "redacted_thinking",
            data: "opaque-secret-payload",
          },
        },
      },
    });

    expect(preview).toEqual({
      type: "reasoning",
      text: "",
      providerOptions: {
        anthropic: { continuation: "[provider continuation]" },
      },
    });
    expect(JSON.stringify(preview)).not.toContain("opaque-secret-payload");
  });

  it("uses semantic audio and video descriptors without retaining sources", () => {
    expect(
      sanitizeMediaPreview([
        {
          type: "audio",
          source: new Uint8Array([1, 2]),
          mediaType: "audio/wav",
        },
        {
          type: "video",
          source: "https://example.test/SECRET_VIDEO.mp4",
          mediaType: "video/mp4",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        kind: "audio",
        mediaType: "audio/wav",
        sizeBytes: 2,
        sourceCategory: "bytes",
      }),
      expect.objectContaining({
        kind: "video",
        mediaType: "video/mp4",
        sourceCategory: "url",
      }),
    ]);
    expect(
      JSON.stringify(
        sanitizeMediaPreview({
          type: "audio",
          source: "AQI=",
          mediaType: "audio/wav",
          filename: "SECRET.wav",
          fileId: "SECRET_ID",
        }),
      ),
    ).not.toContain("SECRET");
  });

  it("keeps graph record discriminants while sanitizing media", () => {
    expect(
      sanitizeMediaPreview({ type: "artifact", preview: { content: [] } }),
    ).toMatchObject({
      type: "artifact",
      preview: { content: [] },
    });
  });

  it.each([undefined, "full", "safe"] as const)(
    "sanitizes every media locator and payload under %s capture",
    async (capture) => {
      const transport = createInMemoryObservabilityTransport();
      setObservabilityTransport(transport, { scheduledDelayMs: 0 });
      if (capture) updateHooks({ observabilityCapture: { capture } });
      const namedBlob = Object.assign(
        new Blob([new Uint8Array([7, 8, 9])], { type: "image/png" }),
        {
          name: "SECRET_BLOB_FILENAME.png",
        },
      );
      const cyclic: Record<string, unknown> = {
        payload: "U0VDUkVUX0JBU0U2NF9QQVlMT0FEX1BBWUxPQUQ=",
      };
      cyclic.self = cyclic;

      await observe.span(
        { name: "generate", primitive: "generation.call" },
        async () => {
          observe.artifact({
            kind: "output",
            contentType: "application/json",
            encoding: "json",
            preview: {
              content: [
                {
                  type: "image",
                  source:
                    "https://SECRET_USER:SECRET_PASSWORD@example.com/a.png?SECRET_QUERY#SECRET_FRAGMENT",
                  mediaType: "image/png",
                },
                {
                  type: "image",
                  source: {
                    type: "url",
                    url: new URL(
                      "https://example.com/SECRET_PATH?SECRET_ASSET_QUERY",
                    ),
                    mediaType: "image/png",
                  },
                },
                {
                  type: "file",
                  source: {
                    type: "provider-file",
                    provider: "openai",
                    fileId: "SECRET_PROVIDER_FILE_ID",
                  },
                  filename: "SECRET_PROVIDER_FILENAME.pdf",
                },
                {
                  type: "image",
                  source: "data:image/png;base64,SECRET_DATA_URL",
                  mediaType: "image/png",
                },
                {
                  type: "image",
                  source: new Uint8Array([1, 2, 3]),
                  mediaType: "image/png",
                },
                { type: "image", source: namedBlob, mediaType: "image/png" },
                {
                  type: "file",
                  source: {
                    type: "asset-ref",
                    ref: { uri: "asset://SECRET_ASSET_REF" },
                    mediaType: "application/pdf",
                  },
                  mediaType: "application/pdf",
                  filename: "SECRET_REF_FILENAME.pdf",
                },
                {
                  generated: {
                    type: "image",
                    source: {
                      type: "data",
                      data: new Uint8Array([9, 8, 7]),
                      mediaType: "image/png",
                    },
                    width: 640,
                    height: 480,
                    filename: "SECRET_GENERATED_FILENAME.png",
                  },
                  cyclic,
                  signed: "https://example.com/private?SECRET_SIGNED_QUERY=yes",
                },
              ],
            },
          });
        },
      );
      await observe.flush();

      const output = findArtifact(transport.records, "output");
      const serialized = JSON.stringify(output);
      for (const sentinel of [
        "SECRET_USER",
        "SECRET_PASSWORD",
        "SECRET_QUERY",
        "SECRET_FRAGMENT",
        "SECRET_PATH",
        "SECRET_ASSET_QUERY",
        "SECRET_PROVIDER_FILE_ID",
        "SECRET_PROVIDER_FILENAME",
        "SECRET_DATA_URL",
        "SECRET_BLOB_FILENAME",
        "SECRET_ASSET_REF",
        "SECRET_REF_FILENAME",
        "SECRET_BASE64_PAYLOAD",
        "SECRET_GENERATED_FILENAME",
        "SECRET_SIGNED_QUERY",
      ])
        expect(serialized).not.toContain(sentinel);
      const content = (
        output?.preview as { content: readonly Record<string, unknown>[] }
      ).content;
      expect(content).toHaveLength(8);
      expect(content.slice(0, 7)).toEqual([
        expect.objectContaining({
          kind: "image",
          mediaType: "image/png",
          sourceCategory: "url",
        }),
        expect.objectContaining({
          kind: "image",
          mediaType: "image/png",
          sourceCategory: "url",
        }),
        expect.objectContaining({
          kind: "file",
          sourceCategory: "provider-file",
        }),
        expect.objectContaining({
          kind: "image",
          mediaType: "image/png",
          sourceCategory: "data-url",
        }),
        expect.objectContaining({
          kind: "image",
          mediaType: "image/png",
          sizeBytes: 3,
          digestPrefix: expect.any(String),
        }),
        expect.objectContaining({
          kind: "image",
          mediaType: "image/png",
          sizeBytes: 3,
          sourceCategory: "blob",
        }),
        expect.objectContaining({
          kind: "file",
          mediaType: "application/pdf",
          sourceCategory: "asset-ref",
        }),
      ]);
      expect(content[7]).toMatchObject({
        generated: {
          kind: "image",
          mediaType: "image/png",
          sizeBytes: 3,
          width: 640,
          height: 480,
          sourceCategory: "data",
        },
        cyclic: { payload: "[redacted media]", self: "[Circular]" },
        signed: "[url]",
      });
    },
  );
});

function findArtifact(
  records: readonly CruxGraphRecord[],
  kind: string,
): Extract<CruxGraphRecord, { readonly type: "artifact" }> | undefined {
  return records.find(
    (
      record,
    ): record is Extract<CruxGraphRecord, { readonly type: "artifact" }> =>
      record.type === "artifact" && record.kind === kind,
  );
}
