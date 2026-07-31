import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adapter,
  loopRuntimeAdapter,
  type AdapterSpec,
} from "../src/adapter";
import { fakeLoopRuntime } from "../src/adapter/testing";
import type { CallArgs } from "../src/adapter/types";
import { createSemanticCache } from "../src/cache";
import { prompt, type ThreadHistoryEntry } from "../src/prompt";
import type { CruxPlugin } from "../src/runtime/plugin";
import { resetHooks } from "../src/runtime/runtime";
import { inMemoryStorage } from "../src/storage";
import { thread, ThreadCommitError } from "../src/thread";
import {
  denseEmbedding,
  installSemanticCachePlugins,
} from "./cache/semantic-cache.fixtures";
import {
  generateCachedPair,
  type GenerateRegime,
} from "./cache/semantic-cache-generate-safety.fixtures";
import {
  replaceLastAssistant,
  response,
} from "./thread-execution-fixtures";

const regimes: readonly GenerateRegime[] = ["core", "sdk"];

afterEach(() => {
  resetHooks();
});

describe.each(regimes)("thread managed generate edge cases — %s", (regime) => {
  it("does not commit authored assistant/tool preamble messages", async () => {
    const conversation = thread({
      id: `authored-preamble-${regime}`,
      storage: inMemoryStorage(),
    });
    const answer = prompt({
      id: `authored-preamble-answer-${regime}`,
      use: [conversation],
      messages: () => [
        { role: "user", content: "Authored setup" },
        {
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: "authored-call",
            toolName: "lookup",
            input: {},
          }],
        },
        {
          role: "tool",
          content: "Authored result",
          metadata: {
            toolCallId: "authored-call",
            toolName: "lookup",
          },
        },
        { role: "user", content: "Rendered current turn" },
      ],
    });

    await generate(regime, answer);

    expect(projectMessages((await conversation.read()).entries)).toEqual([
      ["user", "Rendered current turn"],
      ["assistant", "Accepted answer"],
    ]);
    expect(JSON.stringify(await conversation.read())).not.toContain(
      "Authored setup",
    );
    expect(JSON.stringify(await conversation.read())).not.toContain(
      "Authored result",
    );
  });

  it("publishes a fresh current turn from a generate cache hit", async () => {
    const storage = inMemoryStorage();
    const conversation = thread({
      id: `cached-generate-${regime}`,
      storage,
    });
    const answer = prompt({
      id: `cached-generate-answer-${regime}`,
      use: [conversation],
      input: z.object({ message: z.string() }),
      cache: {
        semantic: {
          version: "v1",
          query: ({ input }) => String(input.message),
        },
      },
      prompt: ({ input }) => input.message,
    });

    const pair = await generateCachedPair({
      regime,
      kind: "text",
      prompt: answer,
      providerOutputs: ["Cached answer"],
      storage,
    });

    expect(pair.providerCalls).toBe(1);
    expect(pair.second).toHaveProperty("threadCommit");
    expect(projectMessages((await conversation.read()).entries)).toEqual([
      ["user", "billing help"],
      ["assistant", "Cached answer"],
      ["user", "billing help"],
      ["assistant", "Cached answer"],
    ]);
  });

  it("preserves structured cache evidence while attaching Thread receipts", async () => {
    const storage = inMemoryStorage();
    const conversation = thread({
      id: `structured-cache-${regime}`,
      storage,
    });
    const answer = prompt({
      id: `structured-cache-answer-${regime}`,
      use: [conversation],
      input: z.object({ message: z.string() }),
      output: z.object({ answer: z.string() }),
      cache: { semantic: { version: "v1" } },
      prompt: ({ input }) => input.message,
    });

    const pair = await generateCachedPair({
      regime,
      kind: "object",
      prompt: answer,
      providerOutputs: ['{"answer":"Cached answer"}'],
      storage,
    });

    expect(pair.providerCalls).toBe(1);
    expect(pair.first).toHaveProperty("threadCommit");
    expect(pair.second).toHaveProperty("threadCommit");
    expect((await conversation.read()).entries).toHaveLength(4);
  });

  it("publishes and caches the fully composed outer middleware result", async () => {
    const storage = inMemoryStorage();
    const conversation = thread({
      id: `composed-cache-${regime}`,
      storage,
    });
    const answer = prompt({
      id: `composed-cache-answer-${regime}`,
      use: [conversation],
      input: z.object({ message: z.string() }),
      cache: { semantic: { version: "v1" } },
      prompt: ({ input }) => input.message,
    });
    const wrapper: CruxPlugin = {
      name: `outer-result-${regime}`,
      install: () => ({
        middleware: async (args, next) => {
          const result = await next(args);
          const messages = Array.isArray(result.messages)
            ? replaceLastAssistant(result.messages, "Outer answer")
            : undefined;
          return {
            ...result,
            text: "Outer answer",
            content: [{ type: "text", text: "Outer answer" }],
            ...(messages ? { messages } : {}),
          };
        },
      }),
    };

    const pair = await generateCachedPair({
      regime,
      kind: "text",
      prompt: answer,
      providerOutputs: ["Provider answer"],
      storage,
      plugins: [wrapper],
    });

    expect(pair.providerCalls).toBe(1);
    expect(pair.second.text).toBe("Outer answer");
    expect(projectMessages((await conversation.read()).entries)).toEqual([
      ["user", "billing help"],
      ["assistant", "Outer answer"],
      ["user", "billing help"],
      ["assistant", "Outer answer"],
    ]);
    const cached = await storage.records.list("crux:semantic-cache:");
    expect(JSON.stringify(cached.entries)).toContain("Outer answer");
    expect(JSON.stringify(cached.entries)).not.toContain("Provider answer");
  });

  it("does not cache or report output when Thread publication fails", async () => {
    const storage = inMemoryStorage();
    const conversation = thread({
      id: `failed-publication-${regime}`,
      storage,
    });
    let failCommit = true;
    let successes = 0;
    const binding = {
      _tag: "Thread",
      id: conversation.id,
      readHistory: () => conversation.readHistory(),
      commitTurn: (turn) =>
        failCommit
          ? Promise.reject(new Error("publication failed"))
          : conversation.commitTurn(turn),
    } satisfies ThreadHistoryEntry;
    installSemanticCachePlugins(
      createSemanticCache({
        storage,
        embedding: denseEmbedding(),
        ttl: 60_000,
        scope: "global",
      }),
    );
    const answer = prompt({
      id: `failed-publication-answer-${regime}`,
      use: [binding],
      input: z.object({ message: z.string() }),
      cache: {
        semantic: {
          version: "v1",
          query: ({ input }) => String(input.message),
        },
      },
      hooks: {
        onGenerate: () => {
          successes++;
        },
      },
      prompt: ({ input }) => input.message,
    });

    const input = { message: "billing help" };
    await expect(generate(regime, answer, input)).rejects.toBeInstanceOf(
      ThreadCommitError,
    );
    expect(successes).toBe(0);
    expect(
      (await storage.records.list("crux:semantic-cache:")).entries,
    ).toHaveLength(0);

    failCommit = false;
    await generate(regime, answer, input);
    expect(successes).toBe(1);
  });

});

async function generate(
  regime: GenerateRegime,
  answer: ReturnType<typeof prompt>,
  input?: Record<string, unknown>,
): Promise<string | undefined> {
  if (regime === "core") {
    const requests: CallArgs[] = [];
    const spec: AdapterSpec<object, object, never> = {
      providerId: "thread-edge-test",
      async call(_client, args) {
        requests.push(args);
        return { raw: {}, extracted: response("Accepted answer") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (messages) => messages,
      mapSettings: (settings) => ({ ...settings }),
    };
    await adapter(spec)({}).generate(answer as never, {
      model: "test-model",
      ...(input ? { input } : {}),
    });
    expect(requests).toHaveLength(1);
    return requests[0]?.system;
  }

  const fake = fakeLoopRuntime({ loops: [[{ text: "Accepted answer" }]] });
  await loopRuntimeAdapter(fake.runtime).generate(answer as never, {
    model: "fake:test-model",
    ...(input ? { input } : {}),
  });
  expect(fake.calls.runTextLoop).toHaveLength(1);
  return fake.calls.runTextLoop[0]?.system;
}

function projectMessages(
  entries: readonly {
    readonly kind: string;
    readonly role?: string;
    readonly content?: unknown;
  }[],
): Array<[string, string]> {
  return entries.map((entry) => [
    entry.role ?? entry.kind,
    typeof entry.content === "string"
      ? entry.content
      : Array.isArray(entry.content)
        ? entry.content
            .flatMap((part) =>
              typeof part === "object" &&
              part !== null &&
              "type" in part &&
              part.type === "text" &&
              "text" in part &&
              typeof part.text === "string"
                ? [part.text]
                : [],
            )
            .join("")
        : "",
  ]);
}
