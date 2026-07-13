import { describe, expect, it } from "vitest";
import {
  loadPersistedMessagesRecord,
  savePersistedMessagesRecord,
} from "../../src/content/persisted-message";
import { fakeAssetStore, fakeRecordStore } from "./persisted-message-test-helpers";

describe("persisted data-URL assets", () => {
  it("externalizes and reloads a data-protocol URL asset as usable data", async () => {
    const operations: string[] = [];
    const records = fakeRecordStore(operations);
    const storage = { records, assets: fakeAssetStore(operations) };

    await savePersistedMessagesRecord({
      storage,
      key: "data-url",
      messages: [{
        role: "user",
        content: [{
          type: "image",
          source: {
            type: "url",
            url: new URL("data:image/png;base64,AQID"),
            mediaType: "image/png",
            filename: "source.png",
            width: 640,
            height: 480,
          },
        }],
      }],
    });

    const record = await records.get("data-url");
    expect(JSON.stringify(record)).toContain("asset-ref");
    expect(JSON.stringify(record)).not.toContain("AQID");
    const [message] = await loadPersistedMessagesRecord({ storage, key: "data-url" });
    expect(message?.content).toMatchObject([{
      type: "image",
      source: {
        type: "data",
        data: new Uint8Array([1, 2, 3]),
        mediaType: "image/png",
        filename: "source.png",
        width: 640,
        height: 480,
        size: 3,
      },
    }]);
  });
});
