import { describe, expect, it } from "vitest";
import {
  UnsupportedContentError,
  contentText,
  filePart,
  hasMediaParts,
  imagePart,
  messageText,
  textPart,
} from "@use-crux/core";

describe("content parts", () => {
  it("builds JSON content parts from text, bytes, and URLs", () => {
    expect(textPart("hello")).toEqual({ type: "text", text: "hello" });

    expect(imagePart({ data: new Uint8Array([1, 2, 3, 255]), mediaType: "image/png" })).toEqual({
      type: "image-data",
      data: "AQID/w==",
      mediaType: "image/png",
    });

    expect(filePart({ data: new ArrayBuffer(2), mediaType: "application/pdf", filename: "a.pdf" })).toEqual({
      type: "file-data",
      data: "AAA=",
      mediaType: "application/pdf",
      filename: "a.pdf",
    });

    expect(imagePart({ url: new URL("https://example.com/chart.png"), mediaType: "image/png" })).toEqual({
      type: "image-url",
      url: "https://example.com/chart.png",
      mediaType: "image/png",
    });

    expect(filePart({ url: "https://example.com/report.pdf", filename: "report.pdf" })).toEqual({
      type: "file-url",
      url: "https://example.com/report.pdf",
      filename: "report.pdf",
    });
  });

  it("projects content to bounded text without exposing raw base64", () => {
    const projection = contentText([
      textPart("Look at this"),
      imagePart({ data: new Uint8Array([1, 2, 3, 255]), mediaType: "image/png" }),
      filePart({
        data: new Uint8Array([4, 5, 6]),
        mediaType: "application/pdf",
        filename: "line\nquote\"control\u0001.pdf",
      }),
    ]);

    expect(projection).toContain("Look at this");
    expect(projection).toMatch(/\[image image\/png 4B sha256:[a-f0-9]{12}\]/);
    expect(projection).toMatch(/\[file application\/pdf "line\\nquote\\"control\\u0001\.pdf" 3B sha256:[a-f0-9]{12}\]/);
    expect(projection).not.toContain("AQID/w==");
    expect(projection).not.toContain("BAUG");
  });

  it("projects URL, id, and custom parts with escaped labels", () => {
    expect(
      contentText([
        { type: "image-url", url: "data:image/png;base64,AQID/w==", mediaType: "image/png" },
        { type: "file-url", url: "https://example.com/a b.pdf", mediaType: "application/pdf", filename: "a\nb.pdf" },
        { type: "file-id", fileId: { openai: "file\n1" } },
        { type: "custom", providerOptions: { provider: { kind: "opaque" } } },
      ]),
    ).toBe(
      [
        "[image image/png data:image/png]",
        "[file application/pdf \"a\\nb.pdf\" https://example.com/a b.pdf]",
        "[file-id {\"openai\":\"file\\n1\"}]",
        "[custom]",
      ].join("\n"),
    );
  });

  it("projects messages and detects media-bearing arrays", () => {
    expect(messageText({ content: [textPart("a"), { type: "image-url", url: "https://example.com/a.png" }] })).toBe(
      "a\n[image https://example.com/a.png]",
    );

    expect(hasMediaParts("plain")).toBe(false);
    expect(hasMediaParts([textPart("plain")])).toBe(false);
    expect(hasMediaParts([textPart("plain"), { type: "custom" }])).toBe(true);
  });
});

describe("UnsupportedContentError", () => {
  it("carries provider degradation context", () => {
    const error = new UnsupportedContentError({
      partType: "file-url",
      mediaType: "application/pdf",
      role: "system",
      provider: "anthropic",
      reason: "system messages are text-only",
    });

    expect(error.name).toBe("UnsupportedContentError");
    expect(error.partType).toBe("file-url");
    expect(error.mediaType).toBe("application/pdf");
    expect(error.role).toBe("system");
    expect(error.provider).toBe("anthropic");
    expect(error.reason).toBe("system messages are text-only");
  });
});
