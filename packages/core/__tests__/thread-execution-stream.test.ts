import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adapter, loopRuntimeAdapter, type AdapterSpec } from "../src/adapter";
import { fakeLoopRuntime } from "../src/adapter/testing";
import type { StreamHandle } from "../src/adapter/types";
import { prompt, type ThreadHistoryEntry } from "../src/prompt";
import { inMemoryStorage } from "../src/storage";
import { thread } from "../src/thread";
import {
  chunks,
  deferred,
  receipt,
  waitFor,
} from "./thread-execution-fixtures";
import {
  streamCachedPair,
  type StreamRegime,
} from "./cache/semantic-cache-stream-safety.fixtures";

describe("thread managed stream execution", () => {
  it("keeps deltas provisional until final Thread publication", async () => {
    const releaseCommit = deferred<void>();
    let commitStarted = false;
    const binding = {
      _tag: "Thread",
      id: "stream-publication",
      readHistory: async () => ({
        revision: "revision-1",
        messages: [],
        messageIds: [],
      }),
      validateRevision: async () => undefined,
      commitTurn: async () => {
        commitStarted = true;
        await releaseCommit.promise;
        return receipt("stream-user", "stream-assistant");
      },
    } satisfies ThreadHistoryEntry;
    const spec: AdapterSpec<object, object, AsyncIterable<string>> = {
      providerId: "thread-stream-test",
      async call() {
        throw new Error("not used");
      },
      async stream(): Promise<StreamHandle<AsyncIterable<string>>> {
        return {
          rawStream: chunks(["provisional"]),
          extractTextDelta: (chunk) =>
            typeof chunk === "string" ? chunk : undefined,
          completion: async () => ({
            text: "provisional",
            content: [{ type: "text", text: "provisional" }],
            finishReason: "stop",
          }),
        };
      },
      appendToolRound: (messages) => messages,
      mapSettings: (settings) => ({ ...settings }),
    };
    const runtime = adapter(spec)({});
    const answer = prompt({
      id: "managed-stream-answer",
      use: [binding],
      prompt: "Stream this",
    });

    const result = await runtime.stream(answer, { model: "test-model" });
    const reader = result.textStream[Symbol.asyncIterator]();
    await expect(reader.next()).resolves.toEqual({
      done: false,
      value: "provisional",
    });
    const completion = result.completion;
    await waitFor(() => commitStarted);
    let settled = false;
    void completion.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseCommit.resolve();
    await expect(completion).resolves.toMatchObject({
      threadCommit: {
        messageIds: ["stream-user", "stream-assistant"],
      },
    });
  });

  it("awaits Thread publication on SDK-owned stream completion", async () => {
    const releaseCommit = deferred<void>();
    let commitStarted = false;
    const conversation = thread({
      id: "sdk-stream-publication",
      storage: inMemoryStorage(),
    });
    const binding = {
      _tag: "Thread",
      id: conversation.id,
      readHistory: () => conversation.readHistory(),
      validateRevision: (revision) => conversation.validateRevision(revision),
      commitTurn: async (turn) => {
        commitStarted = true;
        await releaseCommit.promise;
        return conversation.commitTurn(turn);
      },
    } satisfies ThreadHistoryEntry;
    const fake = fakeLoopRuntime({ streams: [["sdk stream"]] });
    const runtime = loopRuntimeAdapter(fake.runtime);
    const answer = prompt({
      id: "managed-sdk-stream-answer",
      use: [binding],
      prompt: "Stream through the SDK",
    });

    const result = await runtime.stream(answer, {
      model: "fake:test-model",
    });
    const completion = result.completion();
    await waitFor(() => commitStarted);
    releaseCommit.resolve();

    await expect(completion).resolves.toMatchObject({
      threadCommit: {
        messageIds: [expect.any(String), expect.any(String)],
      },
    });
    expect((await conversation.read()).entries).toMatchObject([
      { role: "user", content: "Stream through the SDK" },
      {
        role: "assistant",
        content: [{ type: "text", text: "sdk stream" }],
      },
    ]);
  });
});

describe.each(["core", "sdk"] satisfies readonly StreamRegime[])(
  "thread cached stream revision pinning — %s",
  (regime) => {
    it("rejects replay before exposing a stale cached stream", async () => {
      const conversation = thread({
        id: `cached-stream-revision-${regime}`,
        storage: inMemoryStorage(),
      });
      let mutateAfterRead = false;
      let mutated = false;
      const binding = {
        _tag: "Thread",
        id: conversation.id,
        readHistory: async () => {
          const history = await conversation.readHistory();
          if (mutateAfterRead && !mutated) {
            mutated = true;
            await conversation.append({
              id: `concurrent-stream-${regime}`,
              role: "user",
              content: "Concurrent mutation",
            });
          }
          return history;
        },
        validateRevision: (revision) => conversation.validateRevision(revision),
        commitTurn: (turn) => conversation.commitTurn(turn),
      } satisfies ThreadHistoryEntry;
      const answer = prompt({
        id: `cached-stream-revision-answer-${regime}`,
        use: [binding],
        input: z.object({ message: z.string() }),
        cache: {
          semantic: {
            version: "v1",
            query: ({ input }) => String(input.message),
          },
        },
        prompt: ({ input }) => input.message,
      });

      await expect(
        streamCachedPair({
          regime,
          kind: "text",
          prompt: answer,
          cachedOutput: "Cached answer",
          between: () => {
            mutateAfterRead = true;
          },
        }),
      ).rejects.toMatchObject({ code: "identity_conflict" });
    });
  },
);
