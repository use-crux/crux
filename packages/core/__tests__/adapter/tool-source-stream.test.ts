import { mcp, stdio } from "@use-crux/mcp";
import { describe, expect, it, vi } from "vitest";

import { adapter } from "../../src/adapter/define-adapter";
import type { AdapterSpec } from "../../src/adapter/spec";
import { prompt } from "../../src/prompt/prompt";
import type { ToolSourceMaterializer } from "../../src/tools/tool-source";
import {
  materializeToolSources,
  setToolSourceCleanupFailureHook,
  type ToolSourceCleanupFailure,
} from "../../src/adapter/execution/tool-sources";

interface TestChunk {
  readonly text: string;
}

type TestStream = AsyncIterable<TestChunk>;

const source = mcp({
  id: "stream-source",
  transport: stdio({ command: "fixture-server" }),
});

describe("stream tool-source lifecycle", () => {
  it("materializes before provider I/O and closes once after completion", async () => {
    const events: string[] = [];
    const close = vi.fn(async () => {
      events.push("close");
    });
    const materialize = vi.fn(async () => {
      events.push("materialize");
      return { tools: {}, close };
    });
    const fixture = createStreamAdapter(materialize, async () => {
      events.push("provider");
      return successfulHandle(["hello"]);
    });

    const result = await fixture.stream(streamPrompt(), {
      model: "fixture-model",
    });
    const chunks: string[] = [];
    for await (const chunk of result.textStream) chunks.push(chunk);
    await result.completion;

    expect(chunks).toEqual(["hello"]);
    expect(events).toEqual(["materialize", "provider", "close"]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes when provider stream setup fails", async () => {
    const primary = new Error("stream setup failed");
    const close = vi.fn();
    const fixture = createStreamAdapter(
      async () => ({ tools: {}, close }),
      () => Promise.reject(primary),
    );

    await expect(
      fixture.stream(streamPrompt(), { model: "fixture-model" }),
    ).rejects.toMatchObject({
      name: "CruxAdapterError",
      message: primary.message,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes when lifecycle preparation rejects toolsContext", async () => {
    const close = vi.fn();
    const provider = vi.fn(async () => successfulHandle([]));
    const fixture = createStreamAdapter(
      async () => ({
        tools: { lookup: { description: "No context schema." } },
        close,
      }),
      provider,
    );

    await expect(
      fixture.stream(streamPrompt(), {
        model: "fixture-model",
        toolsContext: { lookup: { opaque: true } },
      }),
    ).rejects.toThrow(
      'toolsContext.lookup was provided, but tool "lookup" does not declare contextSchema',
    );
    expect(provider).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes exactly once when the provider stream errors", async () => {
    const primary = new Error("stream read failed");
    const close = vi.fn();
    const fixture = createStreamAdapter(
      async () => ({ tools: {}, close }),
      async () => ({
        rawStream: {
          async *[Symbol.asyncIterator]() {
            throw primary;
          },
        },
        extractTextDelta: () => undefined,
        completion: async () => undefined,
      }),
    );

    const result = await fixture.stream(streamPrompt(), {
      model: "fixture-model",
    });
    const read = result.textStream[Symbol.asyncIterator]().next();

    await expect(read).rejects.toBe(primary);
    await expect(result.completion).rejects.toBe(primary);
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes exactly once when the consumer disposes the stream", async () => {
    const close = vi.fn();
    const fixture = createStreamAdapter(
      async () => ({ tools: {}, close }),
      async () => successfulHandle(["first", "second"]),
    );
    const result = await fixture.stream(streamPrompt(), {
      model: "fixture-model",
    });
    const iterator = result.textStream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ value: "first" });
    await iterator.return?.();

    expect(close).toHaveBeenCalledOnce();
  });

  it("closes exactly once when the invocation is aborted", async () => {
    const controller = new AbortController();
    const close = vi.fn();
    const fixture = createStreamAdapter(
      async () => ({ tools: {}, close }),
      async () => successfulHandle([]),
    );
    const result = await fixture.stream(streamPrompt(), {
      model: "fixture-model",
      signal: controller.signal,
    });

    controller.abort(new Error("caller aborted"));
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    await result.textStream[Symbol.asyncIterator]().return?.();

    expect(close).toHaveBeenCalledOnce();
  });
});

describe("tool-source cleanup", () => {
  it("closes earlier sessions in reverse order without masking setup failure", async () => {
    const first = mcp({
      id: "first-source",
      transport: stdio({ command: "first" }),
    });
    const second = mcp({
      id: "second-source",
      transport: stdio({ command: "second" }),
    });
    const failing = mcp({
      id: "failing-source",
      transport: stdio({ command: "failing" }),
    });
    const resolved = await prompt({
      id: "cleanup-order",
      use: [first, second, failing],
      prompt: "Test cleanup.",
    }).resolve({});
    const events: string[] = [];
    const cleanupFailures: ToolSourceCleanupFailure[] = [];
    const restoreHook = setToolSourceCleanupFailureHook((failure) =>
      cleanupFailures.push(failure),
    );
    const primary = new Error("third setup failed");

    try {
      await expect(
        materializeToolSources({
          dialect: "fixture",
          resolved,
          runtimeContext: undefined,
          materialize: async (candidate) => {
            if (candidate === failing) throw primary;
            return {
              tools: {},
              async close() {
                events.push(`close:${candidate.id}`);
                if (candidate === first) throw new Error("first close failed");
              },
            };
          },
        }),
      ).rejects.toBe(primary);
    } finally {
      restoreHook();
    }

    expect(events).toEqual(["close:second-source", "close:first-source"]);
    expect(cleanupFailures).toMatchObject([
      { sourceId: "first-source", kind: "error" },
    ]);
  });

  it("bounds a hanging close and records timeout evidence", async () => {
    vi.useFakeTimers();
    const cleanupFailures: ToolSourceCleanupFailure[] = [];
    const restoreHook = setToolSourceCleanupFailureHook((failure) =>
      cleanupFailures.push(failure),
    );
    try {
      const resolved = await streamPrompt().resolve({});
      const session = await materializeToolSources({
        dialect: "fixture",
        resolved,
        runtimeContext: undefined,
        materialize: async () => ({
          tools: {},
          close: () => new Promise<void>(() => {}),
        }),
      });

      const closing = session.close();
      await vi.advanceTimersByTimeAsync(5_000);
      await closing;

      expect(cleanupFailures).toEqual([
        { sourceId: "stream-source", kind: "timeout" },
      ]);
    } finally {
      restoreHook();
      vi.useRealTimers();
    }
  });
});

function streamPrompt() {
  return prompt({
    id: "stream-tool-source",
    use: [source],
    prompt: "Stream a response.",
  });
}

function createStreamAdapter(
  materializeToolSource: ToolSourceMaterializer,
  stream: AdapterSpec<unknown, unknown, TestStream>["stream"],
) {
  return adapter<unknown, unknown, TestStream>({
    providerId: "stream-fixture",
    materializeToolSource,
    mapSettings: () => ({}),
    async call() {
      throw new Error("generate is not used by this test");
    },
    stream,
    appendToolRound: (messages) => messages,
  })({});
}

function successfulHandle(chunks: readonly string[]) {
  const rawStream: TestStream = {
    async *[Symbol.asyncIterator]() {
      for (const text of chunks) yield { text };
    },
  };
  return {
    rawStream,
    extractTextDelta: (chunk: unknown) => (chunk as TestChunk).text,
    completion: async () => ({ finishReason: "stop" as const }),
  };
}
