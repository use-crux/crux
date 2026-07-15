import {
  adapter,
  prompt,
  type AdapterResponse,
  type ToolSourceMaterializer,
} from "@use-crux/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  materializeMcpToolSource,
  mcp,
  streamableHttp,
  type McpToolSource,
} from "../src/index";
import {
  startMcpHttpFixture,
  type McpHttpFixture,
} from "./fixtures/http-server";
import {
  createMcpStdioFixture,
  type McpStdioFixture,
} from "./fixtures/stdio-fixture";

type TransportKind = "http" | "stdio";

interface LifecycleFixture {
  readonly source: McpToolSource;
  waitForCall(): Promise<void>;
  waitForTransportClose(): Promise<void>;
  dispose(): Promise<void>;
}

const fixtures: LifecycleFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});

describe.each<TransportKind>(["http", "stdio"])(
  "official MCP %s invocation lifecycle",
  (kind) => {
    it("closes after successful generation", async () => {
      const fixture = await createLifecycleFixture(kind, {});
      fixtures.push(fixture);
      const close = vi.fn();

      const result = await createLifecycleAdapter(close).generate(
        lifecyclePrompt(fixture.source),
        { model: "fixture-model" },
      );

      expect(result.text).toBe("done");
      expect(close).toHaveBeenCalledOnce();
      await fixture.waitForTransportClose();
    });

    it("closes after a tool protocol error", async () => {
      const fixture = await createLifecycleFixture(kind, {
        callError: "remote tool failed",
      });
      fixtures.push(fixture);
      const close = vi.fn();

      await createLifecycleAdapter(close, true).generate(
        lifecyclePrompt(fixture.source),
        { model: "fixture-model" },
      );

      expect(close).toHaveBeenCalledOnce();
      await fixture.waitForTransportClose();
    });

    it("closes when a tool call times out", async () => {
      const fixture = await createLifecycleFixture(kind, { callDelayMs: 500 });
      fixtures.push(fixture);
      const close = vi.fn();

      await expect(
        createLifecycleAdapter(close, true).generate(
          lifecyclePrompt(fixture.source),
          { model: "fixture-model", timeout: { toolMs: 20 } },
        ),
      ).rejects.toMatchObject({
        name: "TimeoutError",
        budget: "tool",
        toolName: "lookup",
      });

      expect(close).toHaveBeenCalledOnce();
      await fixture.waitForTransportClose();
    });

    it("closes when the caller aborts an active tool call", async () => {
      const fixture = await createLifecycleFixture(kind, { callDelayMs: 500 });
      fixtures.push(fixture);
      const close = vi.fn();
      const controller = new AbortController();
      const generation = createLifecycleAdapter(close, true).generate(
        lifecyclePrompt(fixture.source),
        { model: "fixture-model", signal: controller.signal },
      );

      await fixture.waitForCall();
      controller.abort(new Error("caller aborted"));
      await generation;

      expect(close).toHaveBeenCalledOnce();
      await fixture.waitForTransportClose();
    });
  },
);

describe("per-invocation materialization", () => {
  it("re-evaluates transport context and rediscovers with a fresh signal", async () => {
    const fixture = await createMcpStdioFixture({
      pages: [{ tools: [{ name: "lookup", inputSchema: { type: "object" } }] }],
    });
    const contexts: Array<{
      readonly token: string;
      readonly signal: AbortSignal | undefined;
    }> = [];
    const source = mcp<{ token: string }>({
      id: "resolved-stdio",
      transport: ({ runtimeContext, abortSignal }) => {
        contexts.push({ token: runtimeContext.token, signal: abortSignal });
        return fixture.transport;
      },
    });
    const first = new AbortController();
    const second = new AbortController();
    const close = vi.fn();
    const runtime = createLifecycleAdapter(close);

    try {
      await runtime.generate(lifecyclePrompt(source), {
        model: "fixture-model",
        runtimeContext: { token: "first" },
        signal: first.signal,
      });
      await runtime.generate(lifecyclePrompt(source), {
        model: "fixture-model",
        runtimeContext: { token: "second" },
        signal: second.signal,
      });

      expect(contexts).toEqual([
        { token: "first", signal: first.signal },
        { token: "second", signal: second.signal },
      ]);
      const events = await fixture.events();
      expect(events.filter((event) => event.type === "started")).toHaveLength(
        2,
      );
      expect(events.filter((event) => event.type === "list")).toHaveLength(2);
      expect(events.filter((event) => event.type === "exit")).toHaveLength(2);
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      await fixture.dispose();
    }
  });
});

function lifecyclePrompt<TRuntimeContext>(
  source: McpToolSource<TRuntimeContext>,
) {
  return prompt({
    id: `lifecycle-${source.id}`,
    use: [source],
    prompt: "Run.",
  });
}

function createLifecycleAdapter(close: () => void, callTool = false) {
  let providerCalls = 0;
  const materializeToolSource: ToolSourceMaterializer = async (
    source,
    context,
  ) => {
    const session = await materializeMcpToolSource(
      source as McpToolSource<unknown>,
      context,
    );
    return {
      tools: session.tools,
      async close() {
        close();
        await session.close();
      },
    };
  };
  return adapter({
    providerId: "mcp-lifecycle-fixture",
    materializeToolSource,
    mapSettings: () => ({}),
    async call() {
      providerCalls += 1;
      return {
        raw: { providerCalls },
        extracted:
          callTool && providerCalls === 1
            ? response("", [
                { id: "call-1", name: "lookup", args: { query: "crux" } },
              ])
            : response("done"),
      };
    },
    async stream() {
      throw new Error("stream is not used by this test");
    },
    appendToolRound: (messages) => messages,
  })({});
}

function response(
  text: string,
  toolCalls?: AdapterResponse["toolCalls"],
): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: undefined,
    finishReason: toolCalls ? "tool-calls" : "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}

async function createLifecycleFixture(
  kind: TransportKind,
  scenario: { readonly callDelayMs?: number; readonly callError?: string },
): Promise<LifecycleFixture> {
  if (kind === "stdio") return createStdioLifecycleFixture(scenario);

  const fixture: McpHttpFixture = await startMcpHttpFixture({
    pages: [{ tools: [{ name: "lookup", inputSchema: { type: "object" } }] }],
    callTool: async () => {
      if (scenario.callDelayMs) await delay(scenario.callDelayMs);
      if (scenario.callError) throw new Error(scenario.callError);
      return { content: [{ type: "text", text: "found" }] };
    },
  });
  return {
    source: mcp({
      id: "http-lifecycle",
      transport: streamableHttp({ url: fixture.url }),
    }),
    async waitForCall() {
      await vi.waitFor(() => expect(fixture.toolCalls).toHaveLength(1));
    },
    waitForTransportClose: async () => {},
    dispose: () => fixture.close(),
  };
}

async function createStdioLifecycleFixture(scenario: {
  readonly callDelayMs?: number;
  readonly callError?: string;
}): Promise<LifecycleFixture> {
  const fixture: McpStdioFixture = await createMcpStdioFixture({
    pages: [{ tools: [{ name: "lookup", inputSchema: { type: "object" } }] }],
    callResult: { content: [{ type: "text", text: "found" }] },
    ...scenario,
  });
  return {
    source: mcp({ id: "stdio-lifecycle", transport: fixture.transport }),
    waitForCall: () => fixture.waitForEvent("call"),
    waitForTransportClose: () => fixture.waitForEvent("exit"),
    dispose: () => fixture.dispose(),
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
