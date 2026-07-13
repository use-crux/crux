import { describe, expect, it } from "vitest";
import {
  loadPersistedMessagesRecord,
  savePersistedMessagesRecord,
} from "../../src/content/persisted-message";
import {
  fakeAssetStore,
  fakeRecordStore,
} from "./persisted-message-test-helpers";

describe("persisted assistant lifecycle content", () => {
  it("round-trips assistant tool-call/reasoning parts and audio/video media exactly", async () => {
    const operations: string[] = [];
    const records = fakeRecordStore(operations);
    const assets = fakeAssetStore(operations);
    const storage = { records, assets };

    await savePersistedMessagesRecord({
      storage,
      key: "thread:assistant",
      messages: [
        { role: "user", content: "Describe the clip and call the tool." },
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "I should inspect the clip first." },
            {
              type: "video",
              source: {
                type: "data",
                data: new Uint8Array([1, 2, 3]),
                mediaType: "video/mp4",
              },
            },
            {
              type: "audio",
              source: new URL("https://example.com/clip.mp3"),
              mediaType: "audio/mpeg",
            },
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "lookup",
              input: { query: "clip" },
            },
            { type: "text", text: "Looking that up." },
          ],
        },
      ],
    });

    const loaded = await loadPersistedMessagesRecord({
      storage,
      key: "thread:assistant",
    });

    expect(loaded[0]).toMatchObject({
      role: "user",
      content: "Describe the clip and call the tool.",
    });

    const assistantContent = loaded[1]?.content;
    expect(Array.isArray(assistantContent)).toBe(true);
    expect(assistantContent).toMatchObject([
      { type: "reasoning", text: "I should inspect the clip first." },
      { type: "video", source: { type: "data", mediaType: "video/mp4" } },
      { type: "audio", source: { type: "url", mediaType: "audio/mpeg" } },
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "lookup",
        input: { query: "clip" },
      },
      { type: "text", text: "Looking that up." },
    ]);

    const videoPart = Array.isArray(assistantContent)
      ? assistantContent[1]
      : undefined;
    expect(
      videoPart && videoPart.type === "video" && videoPart.source.type === "data"
        ? [...videoPart.source.data]
        : [],
    ).toEqual([1, 2, 3]);

    const audioPart = Array.isArray(assistantContent)
      ? assistantContent[2]
      : undefined;
    expect(
      audioPart && audioPart.type === "audio" && audioPart.source.type === "url"
        ? audioPart.source.url.href
        : "",
    ).toBe("https://example.com/clip.mp3");
  });
});
