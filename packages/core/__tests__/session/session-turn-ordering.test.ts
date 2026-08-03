import { afterEach, describe, expect, it, vi } from "vitest";
import {
  config,
  createWorkHost,
  prompt,
  resetHooks,
  session,
} from "@use-crux/core";
import { agent, type AgentExecutor } from "@use-crux/core/agent";
import {
  createRuntime,
  createRuntimeProgram,
  inMemoryRuntimeStore,
  node,
  type RuntimeTargetId,
  wakeEnvelopeForWork,
} from "@use-crux/core/runtime";
import { inMemoryRecordStore } from "@use-crux/core/storage";
import { z } from "zod";
import { defineGenerationModel } from "../../src/adapter-authoring";
import { createSessionAgentRuntimeTarget } from "../../src/session/runtime-target";
import type { RuntimeTargetRuntimeRef } from "../../src/runtime/api/target-registry";

afterEach(() => resetHooks());

describe("Session turn ordering", () => {
  it("claims one atomic batch as distinct inputs on one canonical Work", async () => {
    const execute = vi.fn<AgentExecutor>(async (target, options) => {
      const thread = target.prompt.contexts.find(
        (entry) => "_tag" in entry && entry._tag === "Thread",
      );
      if (!thread || thread._tag !== "Thread")
        throw new Error("Missing Thread");
      const history = await thread.readHistory();
      const input = options.input as { message: string };
      const output = { reply: input.message };
      const threadCommit = await thread.commitTurn({
        after: history.head,
        messages: [
          { role: "user", content: input.message },
          { role: "assistant", content: output.reply },
        ],
      });
      return { agentId: target.id, output, durationMs: 1, threadCommit };
    });
    const model = defineGenerationModel({
      adapter: { id: "test", version: "1" },
      native: Object.freeze({ id: "ordered-model" }),
      definition: { id: "test:ordered-model", fingerprint: "ordered-v1" },
      identity: { kind: "model", model: "ordered-model" },
      capabilities: {
        contract: "crux.generation-capabilities.v1",
        language: ["text-input", "text-output", "structured-output"],
        embedding: [],
        image: [],
        speech: [],
        transcription: [],
      },
      runtime: { createAgentExecutor: () => execute },
    });
    const support = agent({
      id: "session-ordered-support",
      model,
      prompt: prompt({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        prompt: ({ input }) => input.message,
      }),
    });
    const program = createRuntimeProgram({
      targets: [support],
      transports: [],
    });
    const store = inMemoryRuntimeStore();
    const records = inMemoryRecordStore();
    const namespace = "session-turn-ordering";
    config({ storage: { records } });
    const host = createWorkHost({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program,
    });
    const runtimeRef: RuntimeTargetRuntimeRef = {};
    const target = createSessionAgentRuntimeTarget(
      support,
      runtimeRef,
      (reference) =>
        reference.definitionId === model.definition.id &&
        reference.fingerprint === model.definition.fingerprint
          ? model
          : undefined,
    );
    const runtime = createRuntime({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      targets: { [support.id as RuntimeTargetId]: target },
      startMaintenance: false,
    });
    runtimeRef.current = runtime;

    try {
      const conversation = await host.run(() =>
        session(support, { key: "ordered-customer" }),
      );
      const [first, second] = await conversation.sendMany([
        { message: "first" },
        { message: "second" },
      ]);
      expect(first!.id).not.toBe(second!.id);
      expect(first!.cursor).toBe("1");
      expect(second!.cursor).toBe("2");
      await expect(conversation.status()).resolves.toMatchObject({
        acceptedCursor: "2",
        pendingInputs: 2,
        pendingWork: 1,
      });
      const [pending] = await store.state.listWork({
        namespace,
        status: "pending",
      });
      expect(pending).toBeDefined();
      expect(
        await store.state.listWork({ namespace, status: "pending" }),
      ).toHaveLength(1);

      const wake = wakeEnvelopeForWork(pending!);
      await Promise.all([
        runtime.kernel.handleWake(wake),
        runtime.kernel.handleWake(wake),
      ]);
      expect(execute).toHaveBeenCalledOnce();
      const [firstWork, secondWork] = await Promise.all([
        first!.work(),
        second!.work(),
      ]);
      expect(firstWork.id).toBe(secondWork.id);
      await expect(
        Promise.all([first!.result(), second!.result()]),
      ).resolves.toEqual([{ reply: "first" }, { reply: "first" }]);
      await expect(conversation.status()).resolves.toEqual({
        state: "parked",
        acceptedCursor: "2",
        processedCursor: "2",
        pendingInputs: 0,
        pendingWork: 0,
      });
      await expect(conversation.thread.read()).resolves.toMatchObject({
        entries: [
          expect.objectContaining({ role: "user", content: "first" }),
          expect.objectContaining({ role: "assistant", content: "first" }),
        ],
      });
    } finally {
      runtime.dispose();
      host.dispose();
    }
  });
});
