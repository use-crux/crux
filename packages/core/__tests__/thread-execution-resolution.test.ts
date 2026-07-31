import { describe, expect, it } from "vitest";
import { adapter } from "../src/adapter";
import { agent } from "../src/agent";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../src/observability";
import { context, prompt, type ThreadHistoryEntry } from "../src/prompt";
import { inMemoryStorage } from "../src/storage";
import { thread } from "../src/thread";
import { simpleSpec } from "./thread-execution-fixtures";

describe("thread managed execution resolution", () => {
  it("lets explicit messages shadow Thread I/O and records the override", async () => {
    const conversation = thread({
      id: "managed-shadow",
      storage: inMemoryStorage(),
    });
    await conversation.append({
      id: "existing",
      role: "user",
      content: "Canonical history",
    });
    const before = JSON.stringify(await conversation.read());
    let reads = 0;
    let commits = 0;
    const binding = {
      _tag: "Thread",
      id: conversation.id,
      readHistory: async () => {
        reads++;
        return conversation.readHistory();
      },
      commitTurn: async (turn) => {
        commits++;
        return conversation.commitTurn(turn);
      },
    } satisfies ThreadHistoryEntry;
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    try {
      const runtime = adapter(simpleSpec("Override answer"))({});
      const answer = prompt({
        id: "managed-shadow-answer",
        use: [binding],
        prompt: "Ignored authored turn",
      });

      await runtime.generate(answer, {
        model: "test-model",
        messages: [{ role: "user", content: "Explicit turn" }],
      });
      await observe.flush();

      expect(reads).toBe(0);
      expect(commits).toBe(0);
      expect(JSON.stringify(await conversation.read())).toBe(before);
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: "span:event",
          name: "thread.history.override",
          attributes: {
            threadId: "managed-shadow",
            reason: "explicit-messages",
          },
        }),
      );
    } finally {
      resetObservabilityRuntime();
    }
  });

  it("rejects duplicate Thread entries anywhere in one use graph", async () => {
    const conversation = thread({
      id: "managed-duplicate",
      storage: inMemoryStorage(),
    });
    const nested = context({
      id: "thread-wrapper",
      use: [conversation],
      system: "Nested context",
    });
    const answer = prompt({
      id: "managed-duplicate-answer",
      use: [conversation, nested],
      prompt: "Do not run",
    });

    await expect(answer.resolve({})).rejects.toThrow(
      'Prompt resolution found multiple Thread entries ("managed-duplicate" and "managed-duplicate"). Use exactly one Thread per prompt graph.',
    );
  });

  it("uses the same managed Thread path for adapter-bound agents", async () => {
    const conversation = thread({
      id: "managed-agent",
      storage: inMemoryStorage(),
    });
    const worker = agent({
      id: "thread-worker",
      model: "test-model",
      prompt: prompt({
        id: "managed-agent-answer",
        use: [conversation],
        prompt: "Agent turn",
      }),
    });
    const runtime = adapter(simpleSpec("Agent answer"))({});

    const result = await runtime.parallel({
      id: "managed-agent-run",
      context: {},
      agents: { worker },
    });

    expect(result.results.worker.output).toBe("Agent answer");
    expect(result.results.worker.threadCommit).toMatchObject({
      messageIds: [expect.any(String), expect.any(String)],
    });
    expect((await conversation.read()).entries).toMatchObject([
      { role: "user", content: "Agent turn" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Agent answer" }],
      },
    ]);
  });
});
