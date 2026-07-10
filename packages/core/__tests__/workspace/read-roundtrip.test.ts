import { describe, expect, it } from "vitest";
import { inMemoryBlobStore, inMemoryRecordStore, storage } from "../../src/storage";
import { workspace } from "../../src/workspace";

describe("workspace read round-trips", () => {
  it("reads blob-backed text as text content", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({
        records: inMemoryRecordStore(),
        blobs: inMemoryBlobStore(),
      }),
      content: { inlineTextBelowBytes: 10 },
    });
    const content = "x".repeat(100);

    await ws.write("/workspace/big.md", content, { mimeType: "text/markdown" });
    const result = await ws.read("/workspace/big.md");

    expect(result).toMatchObject({
      kind: "text",
      path: "/workspace/big.md",
      mimeType: "text/markdown",
      content,
      size: 100,
    });
  });

  it("reads blob-backed JSON as parsed JSON content", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      storage: storage({
        records: inMemoryRecordStore(),
        blobs: inMemoryBlobStore(),
      }),
      content: { inlineTextBelowBytes: 10 },
    });
    const content = {
      title: "Large JSON",
      sections: Array.from({ length: 12 }, (_, index) => ({
        index,
        text: `section ${index}`,
      })),
    };

    await ws.write("/workspace/big.json", content);
    const result = await ws.read("/workspace/big.json");

    expect(result).toMatchObject({
      kind: "json",
      path: "/workspace/big.json",
      mimeType: "application/json",
      content,
    });
  });

  it("windows inline text that exceeds maxInlineBytes instead of throwing", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    const content = "abcdefghijklmnopqrstuvwxyzabc";

    await ws.write("/workspace/inline.txt", content);
    const result = await ws.read("/workspace/inline.txt", {
      maxInlineBytes: 5,
    });

    expect(result).toMatchObject({
      kind: "text",
      path: "/workspace/inline.txt",
      truncated: true,
      size: 29,
    });
    if (result.kind !== "text")
      throw new Error(`Expected text, received ${result.kind}.`);
    expect(
      new TextEncoder().encode(result.content).byteLength,
    ).toBeLessThanOrEqual(5);
  });

  it("reads a text window from the requested byte offset", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    const content = "0123456789".repeat(10);

    await ws.write("/workspace/window.txt", content);
    const result = await ws.read("/workspace/window.txt", {
      maxInlineBytes: 10,
      offset: 90,
    });

    expect(result).toMatchObject({
      kind: "text",
      content: "0123456789",
      truncated: true,
      offset: 90,
      size: 100,
    });
  });

  it("reports the actual UTF-8 boundary used for offset windows", async () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });

    await ws.write("/workspace/unicode.txt", "aébc");
    const result = await ws.read("/workspace/unicode.txt", {
      maxInlineBytes: 3,
      offset: 2,
    });

    expect(result).toMatchObject({
      kind: "text",
      content: "éb",
      offset: 1,
      truncated: true,
    });
  });
});
