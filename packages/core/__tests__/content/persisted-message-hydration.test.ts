import { describe, expect, it } from "vitest";
import { isInvalidMediaSourceError } from "@use-crux/core";
import { decodePersistedMessages } from "../../src/content/persisted-message";
import { fakeAssetStore, fakeRecordStore } from "./persisted-message-test-helpers";

describe("persisted message hydration", () => {
  it("hydrates asset refs and reports missing refs without leaking their URI", async () => {
    const operations: string[] = [];
    const assets = fakeAssetStore(operations);
    const stored = await assets.put({
      type: "data",
      data: new Uint8Array([4]),
      mediaType: "image/png",
    });
    const storage = { records: fakeRecordStore(operations), assets };

    const messages = await decodePersistedMessages({
      storage,
      messages: [{
        role: "user",
        content: [{
          type: "image",
          source: { type: "asset-ref", ref: stored.ref, mediaType: "image/png" },
        }],
      }],
    });
    expect(messages[0]?.content).toMatchObject([
      { type: "image", source: { type: "data", mediaType: "image/png" } },
    ]);

    const error = await decodePersistedMessages({
      storage,
      messages: [{
        role: "user",
        content: [{
          type: "image",
          source: {
            type: "asset-ref",
            ref: { uri: "memory://asset/private/missing" },
            mediaType: "image/png",
          },
        }],
      }],
    }).then(
      () => { throw new Error("Expected missing ref to reject."); },
      (caught: unknown) => caught,
    );
    expect(isInvalidMediaSourceError(error)).toBe(true);
    expect(String(error)).toContain("messages[0].content[0].source");
    expect(String(error)).not.toContain("memory://asset/private/missing");
  });
});
