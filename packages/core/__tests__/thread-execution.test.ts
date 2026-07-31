import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  loopRuntimeAdapter,
  type AdapterSpec,
} from "../src/adapter";
import { fakeLoopRuntime } from "../src/adapter/testing";
import type { CallArgs } from "../src/adapter/types";
import { prompt } from "../src/prompt";
import type { ThreadHistoryEntry } from "../src/prompt";
import { inMemoryStorage } from "../src/storage";
import {
  thread,
  ThreadCommitError,
  type ThreadCommit,
} from "../src/thread";
import {
  deferred,
  response,
  simpleSpec,
} from "./thread-execution-fixtures";

describe("thread managed execution", () => {
  it("prepends exact history and commits only the new accepted turn as one group", async () => {
    const storage = inMemoryStorage();
    const conversation = thread({ id: "managed-generate", storage });
    await conversation.append([
      { id: "prior-user", role: "user", content: "Earlier question" },
      {
        id: "prior-assistant",
        role: "assistant",
        content: "Earlier answer",
      },
    ]);
    const requests: CallArgs[] = [];
    const spec: AdapterSpec<object, object, never> = {
      providerId: "thread-test",
      async call(_client, args) {
        requests.push(args);
        return {
          raw: {},
          extracted: response("New answer"),
        };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (messages) => messages,
      mapSettings: (settings) => ({ ...settings }),
    };
    const runtime = adapter(spec)({});
    const answer = prompt({
      id: "managed-answer",
      use: [conversation],
      prompt: "New question",
    });

    await runtime.generate(answer, { model: "test-model" });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.messages).toEqual([
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "New question" },
    ]);
    const latest = await conversation.read({ limit: 1 });
    expect(latest.entries).toMatchObject([
      { role: "user", content: "New question" },
      { role: "assistant", content: [{ type: "text", text: "New answer" }] },
    ]);
  });

  it("commits a complete accepted tool exchange in the same causal group", async () => {
    const conversation = thread({
      id: "managed-tool-loop",
      storage: inMemoryStorage(),
    });
    const scripted = [
      response("Checking", [{
        id: "weather-1",
        name: "weather",
        args: { city: "Amsterdam" },
      }]),
      response("It is 18°C."),
    ];
    const spec: AdapterSpec<object, object, never> = {
      providerId: "thread-test",
      async call() {
        return { raw: {}, extracted: scripted.shift()! };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound(messages, assistant, results) {
        return [
          ...messages,
          {
            role: "assistant",
            content: assistant.text,
            metadata: { toolCalls: assistant.toolCalls },
          },
          ...results.map((result) => ({
            role: "tool" as const,
            content: result.content,
            metadata: {
              toolCallId: result.toolCallId,
              toolName: result.name,
            },
          })),
        ];
      },
      mapSettings: (settings) => ({ ...settings }),
    };
    const runtime = adapter(spec)({});
    const answer = prompt({
      id: "managed-tool-answer",
      use: [conversation],
      prompt: "What is the weather?",
    });

    await runtime.generate(answer, {
      model: "test-model",
      tools: {
        weather: {
          description: "Get weather",
          execute: () => "18°C",
        },
      },
    });

    expect((await conversation.read({ limit: 1 })).entries).toMatchObject([
      { role: "user", content: "What is the weather?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking" },
          {
            type: "tool-call",
            toolCallId: "weather-1",
            toolName: "weather",
            input: { city: "Amsterdam" },
          },
        ],
      },
      {
        role: "tool",
        content: "18°C",
        metadata: { toolCallId: "weather-1", toolName: "weather" },
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "It is 18°C." }],
      },
    ]);
  });

  it("does not commit rejected validation attempts or corrective messages", async () => {
    const conversation = thread({
      id: "managed-validation-retry",
      storage: inMemoryStorage(),
    });
    let reads = 0;
    const binding = {
      _tag: "Thread",
      id: conversation.id,
      readHistory: async () => {
        reads++;
        return conversation.readHistory();
      },
      validateRevision: (revision) => conversation.validateRevision(revision),
      commitTurn: (turn) => conversation.commitTurn(turn),
    } satisfies ThreadHistoryEntry;
    const fake = fakeLoopRuntime({
      structured: [
        '{"answer":42}',
        '{"answer":"accepted"}',
      ],
    });
    const runtime = loopRuntimeAdapter(fake.runtime);
    const answer = prompt({
      id: "managed-structured-answer",
      use: [binding],
      prompt: "Answer as JSON",
      output: z.object({ answer: z.string() }),
    });

    await runtime.generate(answer, {
      model: "fake:test-model",
      validationRetry: { maxRetries: 1 },
    });

    const entries = (await conversation.read()).entries;
    expect(reads).toBe(1);
    expect(entries).toMatchObject([
      { role: "user", content: "Answer as JSON" },
      { role: "assistant", content: '{"answer":"accepted"}' },
    ]);
    expect(JSON.stringify(entries)).not.toContain('{"answer":42}');
    expect(JSON.stringify(entries)).not.toContain("Validation failed");
  });

  it("exposes the publication receipt and rejects output when commit fails", async () => {
    const successful = thread({
      id: "managed-receipt",
      storage: inMemoryStorage(),
    });
    const runtime = adapter(simpleSpec("Published"))({});
    const answer = prompt({
      id: "managed-receipt-answer",
      use: [successful],
      prompt: "Commit this",
    });

    const result = await runtime.generate(answer, { model: "test-model" });

    expectTypeOf(result.threadCommit).toEqualTypeOf<ThreadCommit | undefined>();
    expect(result.threadCommit).toMatchObject({
      status: "selected",
      messageIds: [expect.any(String), expect.any(String)],
      replayed: false,
    });

    const failing = {
      _tag: "Thread",
      id: "failing-thread",
      readHistory: async () => ({
        revision: "revision-1",
        messages: [],
        messageIds: [],
      }),
      validateRevision: async () => undefined,
      commitTurn: async () => {
        throw new Error("storage unavailable");
      },
    } satisfies ThreadHistoryEntry;
    const failingAnswer = prompt({
      id: "managed-commit-failure",
      use: [failing],
      prompt: "This must reject",
    });

    await expect(
      runtime.generate(failingAnswer, { model: "test-model" }),
    ).rejects.toBeInstanceOf(ThreadCommitError);
  });

  it("commits after the exact observed head when history changes during provider I/O", async () => {
    const conversation = thread({
      id: "managed-observed-root",
      storage: inMemoryStorage(),
    });
    const providerStarted = deferred<void>();
    const releaseProvider = deferred<void>();
    const spec: AdapterSpec<object, object, never> = {
      ...simpleSpec("Managed answer"),
      async call() {
        providerStarted.resolve();
        await releaseProvider.promise;
        return { raw: {}, extracted: response("Managed answer") };
      },
    };
    const runtime = adapter(spec)({});
    const answer = prompt({
      id: "managed-observed-root-answer",
      use: [conversation],
      prompt: "Managed question",
    });

    const generated = runtime.generate(answer, { model: "test-model" });
    await providerStarted.promise;
    await conversation.append({
      id: "concurrent-turn",
      role: "user",
      content: "Concurrent question",
    });
    releaseProvider.resolve();
    const result = await generated;

    expect(result.threadCommit).toMatchObject({ status: "alternative" });
    expect(result.threadCommit).not.toHaveProperty("parentId");
    expect((await conversation.read()).entries).toMatchObject([
      { id: "concurrent-turn", content: "Concurrent question" },
    ]);
    await conversation.select(result.threadCommit!.messageIds[0]!);
    expect((await conversation.read()).entries).toMatchObject([
      { role: "user", content: "Managed question" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Managed answer" }],
      },
    ]);
  });

});
