import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runEvalCellScope, runEvalScope } from "../../src/eval/internal/scope";
import { facts, memory, memoryBlock } from "../../src/memory";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src/observability";
import { prompt } from "../../src/prompt/prompt";
import { config } from "../../src/runtime/config";
import { resetHooks } from "../../src/runtime/runtime";
import { testAdapter } from "../memory/capture/fixtures";

describe("memory capture observation lifecycle", () => {
  afterEach(() => {
    resetHooks();
    resetObservabilityRuntime();
  });

  it("reports safe inline fallback and nests block writes", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const mem = memory({
      id: "fallback-conversation",
      namespace: "thread:1",
      blocks: [
        facts({
          id: "captured-facts",
          extract: async () => [{ content: "Captured turn" }],
          write: { mode: "auto" },
        }),
      ],
    });
    const boundPrompt = prompt({
      id: "fallback-memory-capture-observation",
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    });

    await testAdapter().generate(boundPrompt, {
      model: "model-1",
      input: { message: "Remember this" },
    });
    await observe.flush();

    const captureStart = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "memory.capture",
    );
    const captureEnd = transport.records.find(
      (record) =>
        record.type === "span:end" && record.spanId === captureStart?.spanId,
    );
    const writeStart = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "memory.write",
    );

    expect(captureStart).toMatchObject({
      attributes: expect.objectContaining({ requestedMode: "deferred" }),
    });
    expect(captureEnd).toMatchObject({
      status: "ok",
      attributes: expect.objectContaining({
        disposition: "inline-fallback",
        outcome: "completed",
      }),
    });
    expect(writeStart).toMatchObject({
      runId: captureStart?.runId,
      parentSpanId: captureStart?.spanId,
    });
    expect(
      transport.records.find(
        (record) =>
          record.type === "edge" &&
          record.edgeType === "evidence.for" &&
          record.to.kind === "span" &&
          record.to.id ===
            (writeStart?.type === "span:start" ? writeStart.spanId : ""),
      ),
    ).toMatchObject({
      attributes: expect.objectContaining({
        role: "change",
        evidenceKind: "memory.diff",
        producer: {
          kind: "span",
          id: writeStart?.type === "span:start" ? writeStart.spanId : "",
        },
      }),
    });
    expect(
      transport.records.some(
        (record) =>
          record.type === "edge" &&
          record.edgeType === "evidence.for" &&
          record.to.kind === "span" &&
          record.to.id === captureStart?.spanId,
      ),
    ).toBe(false);
    expect(
      transport.records.some(
        (record) =>
          record.type === "span:start" && record.primitive.startsWith("defer."),
      ),
    ).toBe(false);
  });

  it("reports retained capture after generation returns and work settles", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    let retainedWork: (() => Promise<void>) | undefined;
    const runtime = config({
      host: {
        kind: "memory-observation-retention",
        invocationScope: true,
        retain(work) {
          retainedWork = work;
        },
      },
    });
    const captured: string[] = [];
    let releaseCapture!: () => void;
    const captureCanFinish = new Promise<void>((resolve) => {
      releaseCapture = resolve;
    });
    const mem = memory({
      id: "retained-conversation",
      namespace: "thread:1",
      blocks: [
        memoryBlock({
          id: "capture",
          captureTurn: async () => {
            await captureCanFinish;
            captured.push("completed");
          },
        }),
      ],
    });
    const boundPrompt = prompt({
      id: "retained-memory-capture-observation",
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    });

    try {
      await testAdapter().generate(boundPrompt, {
        model: "model-1",
        input: { message: "Remember this later" },
      });
      await observe.flush();

      const captureStart = transport.records.find(
        (record) =>
          record.type === "span:start" && record.primitive === "memory.capture",
      );
      expect(retainedWork).toBeTypeOf("function");
      expect(captured).toEqual([]);
      expect(
        transport.records.some(
          (record) =>
            record.type === "span:end" &&
            record.spanId === captureStart?.spanId,
        ),
      ).toBe(false);

      releaseCapture();
      await retainedWork?.();
      await observe.flush();

      expect(captured).toEqual(["completed"]);
      const generationEndIndex = transport.records.findIndex(
        (record) =>
          record.type === "span:end" &&
          transport.records.some(
            (start) =>
              start.type === "span:start" &&
              start.primitive === "generation.call" &&
              start.spanId === record.spanId,
          ),
      );
      const captureEndIndex = transport.records.findIndex(
        (record) =>
          record.type === "span:end" && record.spanId === captureStart?.spanId,
      );
      expect(captureEndIndex).toBeGreaterThan(generationEndIndex);
      expect(transport.records[captureEndIndex]).toMatchObject({
        status: "ok",
        attributes: expect.objectContaining({
          disposition: "retained",
          outcome: "completed",
        }),
      });
    } finally {
      releaseCapture();
      runtime.dispose();
    }
  });

  it("reports Eval-captured intent without running memory hooks", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const captured: string[] = [];
    const mem = memory({
      id: "eval-conversation",
      namespace: "thread:1",
      blocks: [
        memoryBlock({
          id: "capture",
          captureTurn: async () => {
            captured.push("unexpected");
          },
        }),
      ],
    });
    const boundPrompt = prompt({
      id: "eval-memory-capture-observation",
      use: [mem],
      input: z.object({ message: z.string() }),
      prompt: ({ input }) => input.message,
    });

    await runEvalScope("memory-observation", () =>
      runEvalCellScope(
        { caseId: "capture", variant: "current", trial: 0 },
        () =>
          testAdapter().generate(boundPrompt, {
            model: "model-1",
            input: { message: "Do not persist" },
          }),
      ),
    );
    await observe.flush();

    const captureStart = transport.records.find(
      (record) =>
        record.type === "span:start" && record.primitive === "memory.capture",
    );
    const captureEnd = transport.records.find(
      (record) =>
        record.type === "span:end" && record.spanId === captureStart?.spanId,
    );
    expect(captured).toEqual([]);
    expect(captureEnd).toMatchObject({
      status: "ok",
      attributes: expect.objectContaining({
        disposition: "eval-captured",
        outcome: "captured",
      }),
    });
    expect(
      transport.records.some(
        (record) =>
          record.type === "span:start" && record.primitive === "memory.write",
      ),
    ).toBe(false);
  });

  it("does not create a capture span or Run outside observability", async () => {
    const transport = createInMemoryObservabilityTransport();
    setObservabilityTransport(transport);
    const mem = memory({
      id: "direct-conversation",
      namespace: "thread:1",
      capture: { mode: "inline" },
      blocks: [
        facts({
          id: "captured-facts",
          extract: async () => [{ content: "Captured turn" }],
          write: { mode: "auto" },
        }),
      ],
    });

    await mem.captureTurn({
      messages: [{ role: "user", content: "Remember direct capture" }],
    });
    await observe.flush();

    expect(
      transport.records.some(
        (record) =>
          (record.type === "span:start" &&
            record.primitive === "memory.capture") ||
          (record.type === "run:start" &&
            record.rootPrimitive === "memory.capture"),
      ),
    ).toBe(false);
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: "span:start",
        primitive: "memory.write",
      }),
    );
  });
});
