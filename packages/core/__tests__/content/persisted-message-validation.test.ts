import { describe, expect, it } from "vitest";
import { isInvalidMediaSourceError } from "@use-crux/core";
import { loadPersistedMessagesRecord } from "../../src/content/persisted-message";
import {
  fakeAssetStore,
  fakeRecordStore,
} from "./persisted-message-test-helpers";

describe("persisted message validation", () => {
  it.each([
    ["non-HTTPS URL", { type: "url", url: "http://SECRET_HOST/a.png" }],
    ["malformed URL", { type: "url", url: "https://%SECRET_URL" }],
    [
      "malformed MIME",
      { type: "url", url: "https://example.com/a", mediaType: "SECRET_MIME" },
    ],
    [
      "empty provider",
      { type: "provider-file", provider: " ", fileId: "file-1" },
    ],
    [
      "empty file ID",
      { type: "provider-file", provider: "openai", fileId: " " },
    ],
    [
      "empty ref",
      { type: "asset-ref", ref: { uri: " " }, mediaType: "image/png" },
    ],
    [
      "invalid asset facts",
      { type: "url", url: "https://example.com/a", info: { size: -1 } },
    ],
  ] as const)(
    "rejects %s through a safe tagged boundary",
    async (_label, source) => {
      const operations: string[] = [];
      const records = fakeRecordStore(operations);
      await records.put("malformed", {
        messages: [{ role: "user", content: [{ type: "image", source }] }],
      } as never);

      const error = await loadPersistedMessagesRecord({
        storage: { records, assets: fakeAssetStore(operations) },
        key: "malformed",
      }).then(
        () => {
          throw new Error("Expected malformed persisted media to reject.");
        },
        (caught: unknown) => caught,
      );

      expect(isInvalidMediaSourceError(error)).toBe(true);
      expect(error).toMatchObject({
        code: "invalid_media_source",
        path: "record.messages",
      });
      expect(String(error)).not.toContain("SECRET_");
    },
  );

  it.each([
    [
      "scalar provider options",
      {
        type: "image",
        source: { type: "url", url: "https://example.com/a.png" },
        providerOptions: { openai: 5 },
      },
    ],
    [
      "filename on image",
      {
        type: "image",
        source: { type: "url", url: "https://example.com/a.png" },
        filename: "not-public.png",
      },
    ],
    [
      "conflicting MIME",
      {
        type: "file",
        source: {
          type: "url",
          url: "https://example.com/a",
          mediaType: "application/pdf",
        },
        mediaType: "text/plain",
      },
    ],
    [
      "non-image MIME",
      {
        type: "image",
        source: {
          type: "url",
          url: "https://example.com/a",
          mediaType: "application/pdf",
        },
      },
    ],
  ] as const)("rejects %s persisted parts", async (_label, part) => {
    const records = fakeRecordStore([]);
    await records.put("malformed-part", {
      messages: [{ role: "user", content: [part] }],
    } as never);
    await expect(
      loadPersistedMessagesRecord({
        storage: { records },
        key: "malformed-part",
      }),
    ).rejects.toMatchObject({
      code: "invalid_media_source",
      path: "record.messages",
    });
  });

  it.each(["system", "user", "tool"] as const)(
    "rejects assistant lifecycle content under the %s role before hydration",
    async (role) => {
      const records = fakeRecordStore([]);
      await records.put("hostile-role", {
        messages: [
          {
            role,
            content: [
              {
                type: "tool-call",
                toolCallId: "call-secret",
                toolName: "lookup",
                input: {},
              },
            ],
          },
        ],
      } as never);

      await expect(
        loadPersistedMessagesRecord({
          storage: { records },
          key: "hostile-role",
        }),
      ).rejects.toMatchObject({
        code: "invalid_media_source",
        path: "record.messages",
      });
    },
  );
});
