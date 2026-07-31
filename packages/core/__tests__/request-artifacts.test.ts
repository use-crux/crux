import { describe, expect, it, vi } from "vitest";
import {
  adapter,
  config,
  history,
  prompt,
  type AdapterSpec,
  type CallArgs,
  type CruxHostBinding,
} from "../src";
import { inMemoryRecordStore } from "../src/storage";
import { historyArtifactIdentity } from "../src/request/artifacts/identity";
import {
  findHistorySummaryArtifact,
  prepareHistorySummaryArtifact,
} from "../src/request/artifacts/lifecycle";
import { threadHistorySource } from "../src/request/history/source";
import { summarize } from "../src/request/history/strategies";
import {
  historyResponse as response,
  managedHistoryMessages as messages,
} from "./request-history-harness";

function managedPrompt(
  id: string,
  onMiss: "inline" | "recent-only" | "fail" = "inline",
) {
  return prompt({
    id,
    use: [history({ recent: 2, providerNative: false, onMiss })],
    prompt: "unused in manual transcript mode",
  });
}

describe.sequential("managed history artifacts", () => {
  it("uses message digests for manual history and Thread revision ranges for Thread history", () => {
    const common = {
      strategy: summarize.regenerate(),
      provider: "artifact-identity-test",
      model: "model-1",
      providerNative: false,
    };
    const manualA = historyArtifactIdentity({
      ...common,
      prefix: [{ role: "user", content: "first" }],
    });
    const manualB = historyArtifactIdentity({
      ...common,
      prefix: [{ role: "user", content: "second" }],
    });
    const threadA = historyArtifactIdentity({
      ...common,
      prefix: [{ role: "user", content: "first" }],
      threadRange: {
        source: "thread:conversation",
        revision: "thread-revision-1",
        range: "range-1",
        offset: 0,
        start: "message-1",
        end: "message-1",
        length: 1,
      },
    });
    const threadSameRange = historyArtifactIdentity({
      ...common,
      prefix: [{ role: "user", content: "different rendered content" }],
      threadRange: {
        source: "thread:conversation",
        revision: "thread-revision-1",
        range: "range-1",
        offset: 0,
        start: "message-1",
        end: "message-1",
        length: 1,
      },
    });

    expect(manualA.id).not.toBe(manualB.id);
    expect(threadA.id).toBe(threadSameRange.id);
    expect(
      historyArtifactIdentity({
        ...common,
        prefix: [{ role: "user", content: "first" }],
        threadRange: {
          source: "thread:conversation",
          revision: "thread-revision-2",
          range: "range-1",
          offset: 0,
          start: "message-1",
          end: "message-1",
          length: 1,
        },
      }).id,
    ).not.toBe(threadA.id);
  });

  it("reuses a compatible Thread prefix across later revisions", async () => {
    const records = inMemoryRecordStore();
    const installation = config({ storage: { records } });
    let revision = "thread-revision-1";
    const artifactRange = (span: { offset: number; length: number }) => ({
      source: "thread:compatible-prefix",
      revision,
      range: `range:${span.offset}:${span.length}`,
      offset: span.offset,
      length: span.length,
    });
    const common = {
      artifactRange,
      artifactOffset: 0,
      strategy: summarize.regenerate(),
      provider: "artifact-thread-prefix-test",
      model: "model-1",
      providerNative: false,
    };
    try {
      await prepareHistorySummaryArtifact({
        ...common,
        prefix: messages.slice(0, 2),
        generate: async () => ({ summary: "older prefix" }),
      }).artifact;
      revision = "thread-revision-2";

      const artifact = await findHistorySummaryArtifact({
        ...common,
        prefix: messages.slice(0, 4),
      });

      expect(artifact).toMatchObject({
        summary: "older prefix",
        stale: true,
        identity: {
          prefixLength: 2,
          threadRange: { revision: "thread-revision-2", length: 2 },
        },
      });
    } finally {
      installation.dispose();
    }
  });

  it("identifies a summarized Thread range after leading system messages", () => {
    const source = threadHistorySource({
      id: "leading-system",
      revision: "thread-revision-1",
      messages: [
        { role: "system", content: "directive" },
        { role: "user", content: "question" },
        { role: "assistant", content: "answer" },
      ],
      messageIds: ["system-1", "user-1", "assistant-1"],
      current: [],
      validate: async () => undefined,
    });

    expect(source.artifactRange?.({ offset: 1, length: 1 })).toMatchObject({
      start: "user-1",
      end: "user-1",
      offset: 1,
      length: 1,
    });
  });

  it("deduplicates concurrent preparation and reuses one content-addressed artifact", async () => {
    const records = inMemoryRecordStore();
    const installation = config({ storage: { records } });
    let releaseSummary!: () => void;
    const summaryGate = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    const calls: CallArgs[] = [];
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "artifact-dedup-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call(_client, args) {
        calls.push(args);
        if (args.system?.includes("conversation summarizer")) {
          await summaryGate;
          return {
            raw: { text: "shared summary" },
            extracted: response("shared summary"),
          };
        }
        return { raw: { text: "done" }, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (value) => value,
      mapSettings: () => ({}),
    };
    const runtime = adapter(spec)({});
    const reply = managedPrompt("artifact-dedup");

    try {
      const first = runtime.generate(reply, {
        model: "artifact-model",
        messages,
        inputBudget: { max: 72, optimizeAt: 60 },
      });
      const second = runtime.generate(
        managedPrompt("artifact-dedup-recent-only", "recent-only"),
        {
          model: "artifact-model",
          messages,
          inputBudget: { max: 72, optimizeAt: 60 },
        },
      );
      await vi.waitFor(() => {
        expect(
          calls.filter((call) =>
            call.system?.includes("conversation summarizer"),
          ),
        ).toHaveLength(1);
      });
      releaseSummary();
      const results = await Promise.all([first, second]);

      expect(
        calls.filter((call) =>
          call.system?.includes("conversation summarizer"),
        ),
      ).toHaveLength(1);
      expect(
        (await records.list("crux:request-summary:v1:")).entries,
      ).toHaveLength(1);
      expect(
        results.flatMap(
          (result) =>
            result.steps[0]?.request?.warnings.map((warning) => warning.code) ??
            [],
        ),
      ).toEqual(
        expect.arrayContaining([
          "HISTORY_SUMMARY_INLINE",
          "HISTORY_SUMMARY_JOINED",
        ]),
      );
      expect(
        JSON.stringify(
          (await records.list("crux:request-summary:v1:")).entries,
        ),
      ).not.toContain("old question with detailed account context");

      await runtime.generate(reply, {
        model: "artifact-model",
        messages,
        inputBudget: { max: 72, optimizeAt: 60 },
      });
      expect(
        calls.filter((call) =>
          call.system?.includes("conversation summarizer"),
        ),
      ).toHaveLength(1);
    } finally {
      installation.dispose();
    }
  });

  it("retains maintenance after response completion instead of delaying it", async () => {
    const retained: Array<() => Promise<void>> = [];
    const host: CruxHostBinding = {
      kind: "artifact-test",
      invocationScope: false,
      supportsInline: true,
      retain(work) {
        retained.push(work);
      },
    };
    const installation = config({
      host,
      storage: { records: inMemoryRecordStore() },
    });
    const events: string[] = [];
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "artifact-ordering-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call(_client, args) {
        if (args.system?.includes("conversation summarizer")) {
          events.push("summary");
          return {
            raw: { text: "prepared summary" },
            extracted: response("prepared summary"),
          };
        }
        events.push("response");
        return { raw: { text: "done" }, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (value) => value,
      mapSettings: () => ({}),
    };

    try {
      await adapter(spec)({}).generate(managedPrompt("artifact-ordering"), {
        model: "ordering-model",
        messages,
        inputBudget: { max: 1_000, optimizeAt: 50 },
      });

      expect(events).toEqual(["response"]);
      expect(retained).toHaveLength(1);
      await retained[0]!();
      expect(events).toEqual(["response", "summary"]);
    } finally {
      installation.dispose();
    }
  });

  it("uses a valid older-prefix artifact while retaining a fresher replacement", async () => {
    const retained: Array<() => Promise<void>> = [];
    const installation = config({
      host: {
        kind: "artifact-stale-test",
        invocationScope: false,
        supportsInline: true,
        retain(work) {
          retained.push(work);
        },
      },
      storage: { records: inMemoryRecordStore() },
    });
    const calls: CallArgs[] = [];
    const spec: AdapterSpec<object, { readonly text: string }> = {
      providerId: "artifact-stale-test",
      capacity: () => ({
        contextWindow: 32_768,
        defaultOutputReserve: 256,
        countingConfidence: "estimated",
      }),
      async call(_client, args) {
        calls.push(args);
        const text = args.system?.includes("conversation summarizer")
          ? "stable older summary"
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
    const reply = managedPrompt("artifact-stale");

    try {
      await runtime.generate(reply, {
        model: "stale-model",
        messages,
        inputBudget: { max: 72, optimizeAt: 60 },
      });
      const extended = [
        ...messages,
        { role: "user" as const, content: "latest question" },
        { role: "assistant" as const, content: "latest answer" },
        { role: "user" as const, content: "follow-up question" },
        { role: "assistant" as const, content: "follow-up answer" },
      ];

      const result = await runtime.generate(reply, {
        model: "stale-model",
        messages: extended,
        inputBudget: { max: 150, optimizeAt: 120 },
      });

      expect(calls.at(-1)?.messages).toEqual([
        {
          role: "assistant",
          content: "Historical summary:\nstable older summary",
        },
        ...extended.slice(4),
      ]);
      expect(result.steps[0]?.request?.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "HISTORY_SUMMARY_STALE" }),
          expect.objectContaining({
            code: "HISTORY_MAINTENANCE_SCHEDULED",
          }),
        ]),
      );
      expect(retained).toHaveLength(1);
    } finally {
      installation.dispose();
    }
  });
});
