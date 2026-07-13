import { describe, expect, it, vi } from "vitest";
import type { StoredAsset } from "@use-crux/core";
import type { InvocationMessage } from "../../src/content/invocation-types";
import { savePersistedMessagesRecord } from "../../src/content/persisted-message";
import {
  fakeAssetStore,
  fakeRecordStore,
} from "./persisted-message-test-helpers";

describe("persisted message media codec", () => {
  it("persists data assets before the message record and keeps locators JSON-safe", async () => {
    const operations: string[] = [];
    const records = fakeRecordStore(operations);
    const assets = fakeAssetStore(operations);

    await savePersistedMessagesRecord({
      storage: { records, assets },
      key: "thread:1",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this." },
            {
              type: "image",
              source: {
                type: "data",
                data: new Uint8Array([1, 2, 3]),
                mediaType: "image/png",
              },
            },
            {
              type: "file",
              source: {
                type: "url",
                url: new URL("https://example.com/a.pdf"),
                mediaType: "application/pdf",
              },
              filename: "a.pdf",
            },
            {
              type: "file",
              source: {
                type: "provider-file",
                provider: "openai",
                fileId: "file-secret",
                mediaType: "application/pdf",
              },
            },
          ],
          metadata: { turn: 1 },
        },
      ],
    });

    expect(operations).toEqual(["asset.put:image/png", "record.put:thread:1"]);
    const record = await records.get("thread:1");
    expect(record).toMatchObject({
      messages: [
        {
          role: "user",
          metadata: { turn: 1 },
          content: [
            { type: "text", text: "Describe this." },
            {
              type: "image",
              source: { type: "asset-ref", mediaType: "image/png" },
            },
            {
              type: "file",
              filename: "a.pdf",
              source: {
                type: "url",
                url: "https://example.com/a.pdf",
                mediaType: "application/pdf",
              },
            },
            {
              type: "file",
              source: {
                type: "provider-file",
                provider: "openai",
                fileId: "file-secret",
                mediaType: "application/pdf",
              },
            },
          ],
        },
      ],
    });
  });

  it("does not rewrite StoredAsset refs and deduplicates equal data in one save", async () => {
    const operations: string[] = [];
    const records = fakeRecordStore(operations);
    const assets = fakeAssetStore(operations);
    const stored: StoredAsset = {
      type: "data",
      data: new Uint8Array([9]),
      mediaType: "image/png",
      ref: { uri: "memory://asset/existing/private-ref" },
    };
    const duplicate = {
      type: "data",
      data: new Uint8Array([7, 7]),
      mediaType: "image/png",
    } as const;

    await savePersistedMessagesRecord({
      storage: { records, assets },
      key: "thread:2",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: stored },
            { type: "image", source: duplicate },
            { type: "file", source: duplicate },
          ],
        },
      ],
    });

    expect(operations).toEqual(["asset.put:image/png", "record.put:thread:2"]);
    const record = await records.get("thread:2");
    const content = record?.messages as readonly {
      readonly source?: { readonly ref?: { readonly uri: string } };
    }[];
    expect(
      JSON.stringify(content).match(/memory:\/\/asset\/stored\/1/g),
    ).toHaveLength(2);
    expect(JSON.stringify(content)).toContain(
      "memory://asset/existing/private-ref",
    );
  });

  it("rolls back newly written assets and writes no record when persistence fails", async () => {
    const operations: string[] = [];
    const records = fakeRecordStore(operations);
    const assets = fakeAssetStore(operations, { failPutOn: 2 });

    await expect(
      savePersistedMessagesRecord({
        storage: { records, assets },
        key: "thread:fail",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "data",
                  data: new Uint8Array([1]),
                  mediaType: "image/png",
                },
              },
              {
                type: "image",
                source: {
                  type: "data",
                  data: new Uint8Array([2]),
                  mediaType: "image/png",
                },
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow("asset put failed");

    expect(operations).toEqual([
      "asset.put:image/png",
      "asset.put:image/png",
      "asset.delete:memory://asset/stored/1",
    ]);
    expect(await records.get("thread:fail")).toBeNull();
  });

  it("rolls back newly written assets when the record write fails", async () => {
    const operations: string[] = [];
    const records = fakeRecordStore(operations, { failPut: true });
    const assets = fakeAssetStore(operations);

    await expect(
      savePersistedMessagesRecord({
        storage: { records, assets },
        key: "thread:record-fail",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "data",
                  data: new Uint8Array([1]),
                  mediaType: "image/png",
                },
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow("record put failed");

    expect(operations).toEqual([
      "asset.put:image/png",
      "record.put:thread:record-fail",
      "asset.delete:memory://asset/stored/1",
    ]);
    expect(await records.get("thread:record-fail")).toBeNull();
  });

  it("requires assets storage for data persistence and JSON-safe metadata", async () => {
    const operations: string[] = [];
    const records = fakeRecordStore(operations);
    const message = {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "data",
            data: new Uint8Array([1]),
            mediaType: "image/png",
          },
        },
      ],
    } satisfies InvocationMessage;

    await expect(
      savePersistedMessagesRecord({
        storage: { records },
        key: "thread:missing",
        messages: [message],
      }),
    ).rejects.toMatchObject({ code: "invalid_media_source" });

    await expect(
      savePersistedMessagesRecord({
        storage: { records, assets: fakeAssetStore(operations) },
        key: "thread:bad-metadata",
        messages: [{ ...message, metadata: { fn: vi.fn() } as never }],
      }),
    ).rejects.toMatchObject({
      reason: "Message metadata must be a JSON object.",
    });

    expect(operations).toEqual([]);
  });

});
