import { describe, expect, it, vi } from "vitest";
import { isInvalidMediaSourceError } from "@use-crux/core";
import { normalizeInvocationMediaSource } from "../../src/content/invocation-media";

describe("invocation media source normalization", () => {
  it("normalizes HTTPS strings without fetching them", async () => {
    const asset = await normalizeInvocationMediaSource({
      kind: "image",
      source: "https://example.com/image.png?token=secret",
      path: "messages[0].content[1].source",
      mediaType: "Image/PNG; charset=utf-8",
    });

    expect(asset).toMatchObject({
      type: "url",
      mediaType: "image/png",
    });
    expect(asset.type === "url" ? asset.url.href : "").toBe(
      "https://example.com/image.png?token=secret",
    );
  });

  it("decodes bounded data URLs into data assets", async () => {
    const asset = await normalizeInvocationMediaSource({
      kind: "image",
      source: "data:IMAGE/PNG;base64,iVBORw0KGgo=",
      path: "messages[0].content[1].source",
    });

    expect(asset).toMatchObject({
      type: "data",
      mediaType: "image/png",
      size: 8,
    });
    expect(
      asset.type === "data" && asset.data instanceof Uint8Array
        ? [...asset.data]
        : [],
    ).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("decodes binary percent triplets without requiring valid UTF-8", async () => {
    const asset = await normalizeInvocationMediaSource({
      kind: "image",
      source: "data:image/png,%89PNG%0D%0A%1A%0A",
      path: "messages[0].content[0].source",
    });

    expect(
      asset.type === "data" && asset.data instanceof Uint8Array
        ? [...asset.data]
        : [],
    ).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("routes data-protocol URL assets through the bounded data decoder", async () => {
    const asset = await normalizeInvocationMediaSource({
      kind: "image",
      source: {
        type: "url",
        url: new URL("data:image/png;base64,AQID"),
        mediaType: "image/png",
        filename: "source.png",
        width: 640,
        height: 480,
        pageCount: 2,
        size: 999,
      },
      path: "messages[0].content[0].source",
      filename: "part.png",
    });

    expect(asset).toMatchObject({
      type: "data",
      data: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      filename: "part.png",
      width: 640,
      height: 480,
      pageCount: 2,
      size: 3,
    });
  });

  it("rejects oversized data URLs before attempting payload decoding", async () => {
    const oversizedMalformedPayload = "%".repeat(28 * 1024 * 1024);

    await expect(
      normalizeInvocationMediaSource({
        kind: "image",
        source: `data:image/png;base64,${oversizedMalformedPayload}`,
        path: "messages[0].content[0].source",
      }),
    ).rejects.toMatchObject({
      code: "invalid_media_source",
      reason: "Data URL exceeds the 20971520 byte limit.",
    });
  });

  it("rejects oversized plain data URLs with bounded chunked work", async () => {
    await expect(
      normalizeInvocationMediaSource({
        kind: "file",
        source: `data:text/plain,${"a".repeat(20 * 1024 * 1024 + 1)}`,
        path: "messages[0].content[0].source",
      }),
    ).rejects.toMatchObject({
      code: "invalid_media_source",
      reason: "Data URL exceeds the 20971520 byte limit.",
    });
  });

  it("sniffs bounded image byte signatures and copies mutable byte views", async () => {
    const source = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const asset = await normalizeInvocationMediaSource({
      kind: "image",
      source,
      path: "messages[0].content[1].source",
    });

    source.fill(0);

    expect(asset).toMatchObject({
      type: "data",
      mediaType: "image/jpeg",
      size: 7,
    });
    expect(
      asset.type === "data" && asset.data instanceof Uint8Array
        ? asset.data[0]
        : undefined,
    ).toBe(0xff);
  });

  it("projects an explicit filename over asset metadata", async () => {
    const asset = await normalizeInvocationMediaSource({
      kind: "file",
      source: {
        type: "data",
        data: new Uint8Array([1, 2, 3]),
        mediaType: "application/pdf",
        filename: "source.pdf",
      },
      filename: "message.pdf",
      path: "messages[0].content[1].source",
    });

    expect(asset.filename).toBe("message.pdf");

    const bytes = await normalizeInvocationMediaSource({
      kind: "file",
      source: new Uint8Array([1, 2, 3]),
      mediaType: "application/pdf",
      filename: "bytes.pdf",
      path: "messages[0].content[2].source",
    });

    expect(bytes.filename).toBe("bytes.pdf");
  });

  it("materializes Blob-backed usable assets while preserving validated facts", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const read = vi.spyOn(blob, "arrayBuffer");
    const source = {
      type: "data" as const,
      data: blob,
      mediaType: "image/png",
      filename: "chart.png",
      size: 3,
      sha256:
        "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      width: 640,
    };

    const asset = await normalizeInvocationMediaSource({
      kind: "image",
      source,
      path: "messages[0].content[0].source",
    });

    expect(read).toHaveBeenCalledOnce();
    expect(asset).toMatchObject({
      type: "data",
      data: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      filename: "chart.png",
      size: 3,
      sha256: source.sha256,
      width: 640,
    });
  });

  it("rejects malformed sources with safe exact paths", async () => {
    await expect(
      normalizeInvocationMediaSource({
        kind: "image",
        source: "aGVsbG8=",
        path: "messages[0].content[1].source",
      }),
    ).rejects.toMatchObject({
      name: "InvalidMediaSourceError",
      code: "invalid_media_source",
      path: "messages[0].content[1].source",
    });

    const refError = await rejectionOf(
      normalizeInvocationMediaSource({
        kind: "image",
        source: { uri: "asset://tenant/private/ref-123" },
        path: "messages[1].content[0].source",
      } as never),
    );
    expect(isInvalidMediaSourceError(refError)).toBe(true);
    expect(
      refError instanceof Error ? refError.message : String(refError),
    ).toContain("assetStore.get(ref)");
    expect(
      refError instanceof Error ? refError.message : String(refError),
    ).not.toContain("asset://tenant/private/ref-123");

    await expect(
      normalizeInvocationMediaSource({
        kind: "file",
        source: "data:text/plain,%E0%A4%A",
        path: "messages[2].content[0].source",
      }),
    ).rejects.toMatchObject({
      code: "invalid_media_source",
      path: "messages[2].content[0].source",
      reason: "Malformed data URL payload.",
    });
  });

  it("rejects MIME conflicts, typeless files, and wrong provider file ownership", async () => {
    await expect(
      normalizeInvocationMediaSource({
        kind: "image",
        source: new Blob(["png"], { type: "image/png" }),
        mediaType: "image/jpeg",
        path: "messages[0].content[1].source",
      }),
    ).rejects.toMatchObject({ code: "invalid_media_source" });

    await expect(
      normalizeInvocationMediaSource({
        kind: "file",
        source: new Uint8Array([1, 2, 3]),
        path: "messages[0].content[2].source",
      }),
    ).rejects.toMatchObject({
      reason: "File byte sources require an explicit mediaType.",
    });

    const providerError = await rejectionOf(
      normalizeInvocationMediaSource({
        kind: "file",
        source: {
          type: "provider-file",
          provider: "anthropic",
          fileId: "file-secret-123",
        },
        provider: "openai",
        path: "messages[0].content[3].source",
      }),
    );
    expect(isInvalidMediaSourceError(providerError)).toBe(true);
    expect(
      providerError instanceof Error
        ? providerError.message
        : String(providerError),
    ).not.toContain("file-secret-123");
  });
});

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Expected promise to reject.");
    },
    (error: unknown) => error,
  );
}
