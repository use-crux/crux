import { describe, expect, it } from "vitest";
import { adapter } from "../src/adapter";
import { prompt, type ThreadHistoryEntry } from "../src/prompt";
import {
  deferred,
  receipt,
  simpleSpec,
} from "./thread-execution-fixtures";

describe("thread managed completion timeout", () => {
  it("awaits a non-abortable publication after the provider budget ends", async () => {
    const commitStarted = deferred<void>();
    const releaseCommit = deferred<void>();
    const binding = {
      _tag: "Thread",
      id: "slow-publication",
      readHistory: async () => ({
        revision: "revision-1",
        messages: [],
        messageIds: [],
      }),
      validateRevision: async () => undefined,
      commitTurn: async () => {
        commitStarted.resolve();
        await releaseCommit.promise;
        return receipt("user", "assistant");
      },
    } satisfies ThreadHistoryEntry;
    const answer = prompt({
      id: "slow-publication-answer",
      use: [binding],
      prompt: "Wait for publication",
    });

    const pending = adapter(simpleSpec("Published"))({}).generate(answer, {
      model: "test-model",
      timeout: { totalMs: 100 },
    });
    await commitStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 125));
    releaseCommit.resolve();

    await expect(pending).resolves.toMatchObject({
      threadCommit: { messageIds: ["user", "assistant"] },
    });
  });
});
