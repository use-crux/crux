import { describe, expect, it } from "vitest";
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

    await normalizeInvocationMediaSource({
      kind: "image",
      source: { uri: "asset://tenant/private/ref-123" },
      path: "messages[1].content[0].source",
    } as never).catch((error: unknown) => {
      expect(isInvalidMediaSourceError(error)).toBe(true);
      expect(error instanceof Error ? error.message : String(error)).toContain(
        "assetStore.get(ref)",
      );
      expect(
        error instanceof Error ? error.message : String(error),
      ).not.toContain("asset://tenant/private/ref-123");
    });

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

    await normalizeInvocationMediaSource({
      kind: "file",
      source: {
        type: "provider-file",
        provider: "anthropic",
        fileId: "file-secret-123",
      },
      provider: "openai",
      path: "messages[0].content[3].source",
    }).catch((error: unknown) => {
      expect(isInvalidMediaSourceError(error)).toBe(true);
      expect(
        error instanceof Error ? error.message : String(error),
      ).not.toContain("file-secret-123");
    });
  });
});
