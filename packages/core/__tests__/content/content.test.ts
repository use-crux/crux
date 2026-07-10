import { describe, expect, it } from "vitest";
import {
  contentText,
  hasMediaParts,
  messageText,
  textPart,
} from "@use-crux/core";

describe("content parts", () => {
  it("uses text/image/file parts with direct media sources", () => {
    expect(textPart("hello")).toEqual({ type: "text", text: "hello" });

    expect({
      type: "image",
      source: new Uint8Array([1, 2, 3, 255]),
      mediaType: "image/png",
    }).toMatchObject({ type: "image", mediaType: "image/png" });
  });

  it("projects content to bounded text without exposing raw base64", () => {
    const projection = contentText([
      textPart("Look at this"),
      { type: "image", source: new Uint8Array([1, 2, 3, 255]), mediaType: "image/png" },
      {
        type: "file",
        source: new Uint8Array([4, 5, 6]),
        mediaType: "application/pdf",
        filename: "line\nquote\"control\u0001.pdf",
      },
    ]);

    expect(projection).toContain("Look at this");
    expect(projection).toMatch(/\[image image\/png 4B sha256:[a-f0-9]{12}\]/);
    expect(projection).toMatch(/\[file application\/pdf "line\\nquote\\"control\\u0001\.pdf" 3B sha256:[a-f0-9]{12}\]/);
    expect(projection).not.toContain("AQID/w==");
    expect(projection).not.toContain("BAUG");
  });

  it("does not hash oversized base64 payloads in text projections", () => {
    const projection = contentText([
      {
        type: "image",
        source: new Uint8Array(300_000),
        mediaType: "image/png",
      },
    ]);

    expect(projection).toBe("[image image/png 293.0KB sha256:omitted]");
  });

  it("projects URL and provider-file parts with escaped labels", () => {
    expect(
      contentText([
        { type: "image", source: "data:image/png;base64,AQID/w==", mediaType: "image/png" },
        { type: "file", source: new URL("https://example.com/a b.pdf"), mediaType: "application/pdf", filename: "a\nb.pdf" },
        {
          type: "file",
          source: {
            type: "provider-file",
            provider: "openai",
            fileId: "file\n1",
          },
        },
      ]),
    ).toBe(
      [
        "[image image/png data:image/png]",
        "[file application/pdf \"a\\nb.pdf\" https://example.com/a%20b.pdf]",
        "[file provider-file:openai]",
      ].join("\n"),
    );
  });

  it("projects messages and detects media-bearing arrays", () => {
    expect(messageText({ content: [textPart("a"), { type: "image", source: "https://example.com/a.png" }] })).toBe(
      "a\n[image https://example.com/a.png]",
    );

    expect(hasMediaParts("plain")).toBe(false);
    expect(hasMediaParts([textPart("plain")])).toBe(false);
    expect(hasMediaParts([textPart("plain"), { type: "image", source: "https://example.com/a.png" }])).toBe(true);
  });
});
