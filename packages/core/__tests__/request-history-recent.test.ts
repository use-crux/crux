import { describe, expect, it, vi } from "vitest";
import {
  contributor,
  history,
  prompt,
  RequestCompositionError,
  type Message,
} from "../src";
import { inMemoryStorage } from "../src/storage";
import { thread } from "../src/thread";
import {
  historyAdapter,
  sdkHistoryAdapter,
} from "./request-history-harness";

describe("history.recent()", () => {
  it.each(["caller-messages", "thread"] as const)(
    "projects the %s source through the shared history seam",
    async (source) => {
      const harness = historyAdapter();
      const prior: Message[] = [
        { role: "user", content: "old question" },
        { role: "assistant", content: "old answer" },
        { role: "user", content: "new question" },
        { role: "assistant", content: "new answer" },
      ];
      const conversation = thread({
        id: `recent-source-${source}`,
        storage: inMemoryStorage(),
      });
      if (source === "thread") {
        await conversation.append(
          prior.map((message, index) => ({ ...message, id: `prior-${index}` })),
        );
      }
      const reply = prompt({
        id: `recent-source-${source}`,
        use:
          source === "thread"
            ? [conversation, history.recent(2)]
            : [history.recent(2)],
        prompt: "current question",
      });

      const result = await harness.runtime.generate(reply, {
        model: "model-1",
        ...(source === "caller-messages"
          ? { messages: [...prior, { role: "user", content: "current question" }] }
          : {}),
      });

      expect(harness.requests[0]?.messages).toEqual(
        source === "thread"
          ? [...prior.slice(-2), { role: "user", content: "current question" }]
          : [{ role: "user", content: "current question" }],
      );
      expect(result.steps[0]?.request?.history).toMatchObject({ source });
    },
  );

  it("selects the newest messages without preparatory work", async () => {
    const harness = historyAdapter();
    const reply = prompt({
      id: "recent-history-count",
      use: [history.recent(20)],
      prompt: "unused in manual transcript mode",
    });
    const messages: Message[] = Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message-${index + 1}`,
    })) as Message[];

    await harness.runtime.generate(reply, {
      model: "model-1",
      messages,
    });

    expect(harness.call).toHaveBeenCalledOnce();
    expect(harness.requests[0]?.messages).toEqual(messages.slice(20));
  });

  it("applies the same projection at an SDK-owned provider boundary", async () => {
    const harness = sdkHistoryAdapter();
    const reply = prompt({
      id: "recent-history-sdk-loop",
      use: [history.recent(2)],
      prompt: "unused in manual transcript mode",
    });
    const messages: Message[] = [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "new question" },
      { role: "assistant", content: "new answer" },
    ];

    await harness.runtime.generate(reply, {
      model: "model-1",
      messages,
    });

    expect(harness.providerCalls).toHaveBeenCalledOnce();
    expect(harness.requests[0]).toEqual(messages.slice(2));
  });

  it("keeps an oversized newest causal group whole and receipts the overflow", async () => {
    const harness = historyAdapter();
    const reply = prompt({
      id: "recent-history-causal-overflow",
      use: [history.recent({ messages: 2 })],
      prompt: "unused in manual transcript mode",
    });
    const messages: Message[] = [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "new question" },
      {
        role: "assistant",
        content: "calling",
        metadata: {
          toolCalls: [{ id: "call-1", name: "lookup", args: {} }],
        },
      },
      {
        role: "tool",
        content: "tool result",
        metadata: { toolCallId: "call-1", toolName: "lookup" },
      },
      { role: "assistant", content: "new answer" },
    ];

    const result = await harness.runtime.generate(reply, {
      model: "model-1",
      messages,
    });

    expect(harness.requests[0]?.messages).toEqual(messages.slice(2));
    expect(result.steps[0]?.request?.warnings).toEqual([
      expect.objectContaining({ code: "HISTORY_CAP_OVERFLOW" }),
    ]);
  });

  it("applies message and token caps together at causal boundaries", async () => {
    const harness = historyAdapter();
    const reply = prompt({
      id: "recent-history-combined-caps",
      use: [history.recent({ messages: 4, tokens: 4 })],
      prompt: "unused in manual transcript mode",
    });
    const messages: Message[] = [
      { role: "user", content: "an older question with many tokens" },
      { role: "assistant", content: "an older answer with many tokens" },
      { role: "user", content: "new" },
      { role: "assistant", content: "answer" },
    ];

    const result = await harness.runtime.generate(reply, {
      model: "model-1",
      messages,
    });

    expect(harness.requests[0]?.messages).toEqual(messages.slice(2));
    expect(result.steps[0]?.request?.warnings).toEqual([
      expect.objectContaining({ code: "HISTORY_CAUSAL_BOUNDARY" }),
    ]);
  });

  it("retains a leading system prefix while later system messages stay causal", async () => {
    const harness = historyAdapter();
    const reply = prompt({
      id: "recent-history-system-prefix",
      use: [history.recent({ messages: 2 })],
      prompt: "unused in manual transcript mode",
    });
    const messages: Message[] = [
      { role: "system", content: "root directive" },
      { role: "system", content: "second directive" },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "system", content: "updated directive" },
      { role: "user", content: "new question" },
      { role: "assistant", content: "new answer" },
    ];

    await harness.runtime.generate(reply, {
      model: "model-1",
      messages,
    });

    expect(harness.requests[0]?.messages).toEqual([
      ...messages.slice(0, 2),
      ...messages.slice(4),
    ]);
  });

  it("projects prompt-level complete messages when call-site messages are absent", async () => {
    const harness = historyAdapter();
    const messages: Message[] = [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "new question" },
      { role: "assistant", content: "new answer" },
    ];
    const reply = prompt({
      id: "recent-history-prompt-messages",
      use: [history.recent(2)],
      messages: () => messages,
    });

    await harness.runtime.generate(reply, { model: "model-1" });

    expect(harness.requests[0]?.messages).toEqual(messages.slice(2));
  });

  it("rejects a malformed Tool lifecycle before provider dispatch", async () => {
    const harness = historyAdapter();
    const reply = prompt({
      id: "recent-history-malformed-tool",
      use: [history.recent(4)],
      prompt: "unused in manual transcript mode",
    });

    const error = await harness.runtime
      .generate(reply, {
        model: "model-1",
        messages: [
          { role: "user", content: "question" },
          {
            role: "tool",
            content: "orphan result",
            metadata: { toolCallId: "missing-call" },
          },
        ],
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RequestCompositionError);
    expect(error).toMatchObject({ code: "INVALID_COMPOSITION" });
    expect(error.message).toContain("Tool result");
    expect(harness.call).not.toHaveBeenCalled();
  });

  it("rejects multiple resolved projections before provider dispatch", async () => {
    const harness = historyAdapter();
    const nested = contributor({
      id: "nested-history-policy",
      contribute: () => ({ use: [history.recent(4)] }),
    });
    const reply = prompt({
      id: "recent-history-duplicate",
      use: [history.recent(2), nested],
      prompt: "unused in manual transcript mode",
    });

    const error = await harness.runtime
      .generate(reply, {
        model: "model-1",
        messages: [{ role: "user", content: "hello" }],
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RequestCompositionError);
    expect(error).toMatchObject({ code: "INVALID_COMPOSITION" });
    expect(harness.call).not.toHaveBeenCalled();
  });

  it("rejects a projection without a history source before provider dispatch", async () => {
    const harness = historyAdapter();
    const reply = prompt({
      id: "recent-history-missing-source",
      use: [history.recent(2)],
      prompt: "one-shot prompt",
    });

    const error = await harness.runtime
      .generate(reply, { model: "model-1" })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RequestCompositionError);
    expect(error).toMatchObject({ code: "INVALID_COMPOSITION" });
    expect(error.message).toContain("no history source");
    expect(harness.call).not.toHaveBeenCalled();
  });

  it("warns once in development when bare exact history crosses its watermark", async () => {
    const harness = historyAdapter();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reply = prompt({
      id: "bare-history-watermark",
      prompt: "unused in manual transcript mode",
    });
    const options = {
      model: "model-1",
      messages: [
        {
          role: "user" as const,
          content: "a complete exact transcript that exceeds the watermark",
        },
      ],
      inputBudget: { optimizeAt: 1, max: 1_000 },
    };

    const first = await harness.runtime.generate(reply, options);
    const second = await harness.runtime.generate(reply, options);

    expect(first.steps[0]?.request?.warnings).toEqual([
      expect.objectContaining({ code: "HISTORY_EXACT_NEAR_LIMIT" }),
    ]);
    expect(second.steps[0]?.request?.warnings).toEqual([
      expect.objectContaining({ code: "HISTORY_EXACT_NEAR_LIMIT" }),
    ]);
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("points exact-history overflow at authorized history policies", async () => {
    const harness = historyAdapter();
    const secret = "sensitive transcript content";
    const reply = prompt({
      id: "bare-history-overflow",
      prompt: "unused in manual transcript mode",
    });

    const error = await harness.runtime
      .generate(reply, {
        model: "model-1",
        messages: [{ role: "user", content: secret }],
        inputBudget: { max: 1 },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RequestCompositionError);
    expect(error).toMatchObject({ code: "REQUEST_TOO_LARGE" });
    expect(error.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "HISTORY_EXACT_REMEDY",
          message: expect.stringContaining("history.recent()"),
        }),
      ]),
    );
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(harness.call).not.toHaveBeenCalled();
  });
});
