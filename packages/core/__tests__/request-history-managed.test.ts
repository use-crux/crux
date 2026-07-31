import { describe, expect, it, vi } from "vitest";
import {
  adapter,
  history,
  prompt,
  summarize,
  type AdapterSpec,
  type CallArgs,
} from "../src";
import {
  historyResponse as response,
  managedHistoryMessages as historyMessages,
} from "./request-history-harness";

describe("history()", () => {
  it("derives inert defaults and exposes all versioned summary strategies", () => {
    const recent = { messages: 2 };
    const configured = history({ recent });
    recent.messages = 99;
    expect(configured.options.recent).toEqual({ messages: 2 });
    const projection = history();
    expect(projection.options).toMatchObject({
      onMiss: "inline",
      providerNative: true,
      summary: {
        strategy: {
          _tag: "SummarizeStrategy",
          kind: "adaptive",
          version: 1,
        },
      },
    });
    expect(
      [
        summarize.adaptive(),
        summarize.regenerate(),
        summarize.rolling(),
        summarize.hierarchical(),
      ].map((strategy) => strategy.kind),
    ).toEqual([
      "adaptive",
      "regenerate",
      "rolling",
      "hierarchical",
    ]);
    expect(() =>
      history({
        summary: {
          strategy: { _tag: "invalid" } as never,
        },
      }),
    ).toThrow("must be created by summarize");
  });

  it("selects a generated summary prefix plus an exact suffix without mutating canonical history", async () => {
    const requests: CallArgs[] = [];
    const call = vi.fn(async (_client: object, args: CallArgs) => {
      requests.push(args);
      const text = args.system?.includes("conversation summarizer")
        ? "Earlier turns established the account preferences."
        : "done";
      return { raw: { text }, extracted: response(text) };
    });
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "managed-history-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      call,
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (messages) => messages,
      mapSettings: () => ({}),
    };
    const runtime = adapter(spec)({});
    const reply = prompt({
      id: "managed-history-summary",
      use: [
        history({
          recent: 2,
          summary: { strategy: summarize.regenerate() },
          providerNative: false,
        }),
      ],
      prompt: "unused in manual transcript mode",
    });
    const messages = structuredClone(historyMessages);
    const canonical = structuredClone(messages);

    const result = await runtime.generate(reply, {
      model: "model-1",
      messages,
      inputBudget: { max: 75, optimizeAt: 60 },
    });

    expect(call).toHaveBeenCalledTimes(2);
    expect(requests[1]?.messages).toEqual([
      {
        role: "assistant",
        content:
          "Historical summary:\nEarlier turns established the account preferences.",
      },
      ...messages.slice(-2),
    ]);
    expect(result.steps[0]?.request?.adaptations).toEqual([
      expect.objectContaining({
        contributor: "history",
        representation: "summary",
        supportRequestId: expect.stringMatching(/^request_/),
      }),
    ]);
    expect(messages).toEqual(canonical);
  });

  it("handles explicit miss modes and never infers loss from a missing host", async () => {
    const calls: CallArgs[] = [];
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "managed-history-miss-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call(_client, args) {
        calls.push(args);
        return { raw: { text: "done" }, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (value) => value,
      mapSettings: () => ({}),
    };
    const runtime = adapter(spec)({});
    const recentOnly = prompt({
      id: "managed-history-recent-only",
      use: [history({ recent: 2, onMiss: "recent-only" })],
      prompt: "unused in manual transcript mode",
    });

    const result = await runtime.generate(recentOnly, {
      model: "recent-only-model",
      messages: historyMessages,
      inputBudget: { max: 72, optimizeAt: 60 },
    });

    expect(calls[0]?.messages).toEqual(historyMessages.slice(-2));
    expect(result.steps[0]?.request?.adaptations).toEqual([
      expect.objectContaining({
        contributor: "history",
        representation: "omitted",
      }),
    ]);

    const fail = prompt({
      id: "managed-history-fail",
      use: [history({ recent: 2, onMiss: "fail" })],
      prompt: "unused in manual transcript mode",
    });
    const failed = await runtime
      .generate(fail, {
        model: "fail-model",
        messages: historyMessages,
        inputBudget: { max: 72, optimizeAt: 60 },
      })
      .catch((error: unknown) => error);

    expect(failed).toMatchObject({ code: "REPRESENTATION_UNAVAILABLE" });
    expect(calls).toHaveLength(1);

    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const full = await runtime.generate(
      prompt({
        id: "managed-history-missing-host",
        use: [history({ recent: 2 })],
        prompt: "unused in manual transcript mode",
      }),
      {
        model: "missing-host-model",
        messages: historyMessages,
        inputBudget: { max: 1_000, optimizeAt: 50 },
      },
    );

    expect(full.steps[0]?.request?.adaptations).toEqual([]);
    expect(full.steps[0]?.request?.warnings).toEqual([
      expect.objectContaining({ code: "HISTORY_MAINTENANCE_INLINE" }),
    ]);
    expect(
      calls.find((request) =>
        request.model === "missing-host-model" &&
        !request.system?.includes("conversation summarizer"),
      )?.messages,
    ).toEqual(historyMessages);
    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledOnce();
    });
    warning.mockRestore();
  });

  it("uses native compaction by default and bypasses it when explicitly disabled", async () => {
    const native = vi.fn(async () => ({
      summary: "provider-native summary",
      requestId: "request_native_support",
    }));
    const calls: CallArgs[] = [];
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "managed-history-native-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      compactHistory: native,
      async call(_client, args) {
        calls.push(args);
        const text = args.system?.includes("conversation summarizer")
          ? "portable summary"
          : "done";
        return { raw: { text }, extracted: response(text) };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (value) => value,
      mapSettings: () => ({}),
    };
    const runtime = adapter(spec)({});

    await runtime.generate(
      prompt({
        id: "managed-history-native-default",
        use: [history({ recent: 2 })],
        prompt: "unused",
      }),
      {
        model: "native-default-model",
        messages: historyMessages,
        inputBudget: { max: 72, optimizeAt: 60 },
      },
    );
    expect(native).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        model: "native-default-model",
        providerNative: true,
        strategy: expect.objectContaining({ kind: "adaptive" }),
      }),
    );

    await runtime.generate(
      prompt({
        id: "managed-history-explicit-summary",
        use: [
          history({
            recent: 2,
            summary: {
              model: "summary-model",
              strategy: summarize.hierarchical(),
            },
          }),
        ],
        prompt: "unused",
      }),
      {
        model: "response-model",
        messages: historyMessages,
        inputBudget: { max: 72, optimizeAt: 60 },
      },
    );
    expect(native).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({
        model: "summary-model",
        strategy: expect.objectContaining({ kind: "hierarchical" }),
      }),
    );

    await runtime.generate(
      prompt({
        id: "managed-history-portable",
        use: [history({ recent: 2, providerNative: false })],
        prompt: "unused",
      }),
      {
        model: "native-default-model",
        messages: historyMessages,
        inputBudget: { max: 72, optimizeAt: 60 },
      },
    );
    expect(native).toHaveBeenCalledTimes(2);
    expect(
      calls.some((call) =>
        call.system?.includes("conversation summarizer"),
      ),
    ).toBe(true);
  });
});
