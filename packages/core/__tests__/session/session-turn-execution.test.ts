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
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
} from "@use-crux/core/runtime";
import { inMemoryRecordStore } from "@use-crux/core/storage";
import { defineGenerationModel } from "../../src/adapter-authoring";
import { z } from "zod";

afterEach(() => resetHooks());

describe("Session turn execution", () => {
  it("rejects a missing model binding before Session, Work, or Thread mutation", async () => {
    const support = agent({
      id: "session-turn-missing-model",
      prompt: prompt({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        prompt: ({ input }) => input.message,
      }),
    });
    const store = inMemoryRuntimeStore();
    const records = inMemoryRecordStore();
    const namespace = "session-turn-missing-model";
    const put = vi.spyOn(records, "put");
    const create = vi.spyOn(records, "create");
    const mutate = vi.spyOn(records, "mutate");
    config({ storage: { records } });
    const host = createWorkHost({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program: createRuntimeProgram({ targets: [support], transports: [] }),
    });

    try {
      const error = await host
        .run(() =>
          Reflect.apply(session, undefined, [
            support,
            { key: "customer-missing-model" },
          ]),
        )
        .catch((cause: unknown) => cause);
      expect(error).toMatchObject({
        code: "GENERATION_MODEL_BINDING_MISSING",
        whatFailed: expect.any(String),
        why: expect.any(String),
        whatStillWorks: expect.any(String),
        nextStep: expect.any(String),
      });
      expect(error).not.toMatchObject({
        message: expect.stringContaining("customer-missing-model"),
      });
      expect(store.testing.sessionRecords(namespace)).toEqual([]);
      expect(
        await store.state.listWork({ namespace, status: "pending" }),
      ).toEqual([]);
      expect(put).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
    } finally {
      host.dispose();
    }
  });

  it("rejects a missing required capability before mutation or executor invocation", async () => {
    const execute = vi.fn<AgentExecutor>(async () => ({
      agentId: "session-turn-missing-capability",
      output: { reply: "unexpected" },
      durationMs: 1,
    }));
    const model = defineGenerationModel({
      adapter: { id: "test", version: "1" },
      native: Object.freeze({ id: "text-only-model" }),
      definition: { id: "test:text-only-model", fingerprint: "text-only-v1" },
      identity: { kind: "model", model: "text-only-model" },
      capabilities: {
        contract: "crux.generation-capabilities.v1",
        language: ["text-input", "text-output"],
        embedding: [],
        image: [],
        speech: [],
        transcription: [],
      },
      runtime: { createAgentExecutor: () => execute },
    });
    const support = agent({
      id: "session-turn-missing-capability",
      model,
      prompt: prompt({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        prompt: ({ input }) => input.message,
      }),
    });
    const store = inMemoryRuntimeStore();
    const records = inMemoryRecordStore();
    const namespace = "session-turn-missing-capability";
    const put = vi.spyOn(records, "put");
    const create = vi.spyOn(records, "create");
    const mutate = vi.spyOn(records, "mutate");
    config({ storage: { records } });
    const host = createWorkHost({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program: createRuntimeProgram({ targets: [support], transports: [] }),
    });

    try {
      await expect(
        host.run(() =>
          Reflect.apply(session, undefined, [
            support,
            { key: "customer-missing-capability" },
          ]),
        ),
      ).rejects.toMatchObject({
        code: "GENERATION_CAPABILITY_MISSING",
        whatFailed: expect.any(String),
        why: expect.any(String),
        whatStillWorks: expect.any(String),
        nextStep: expect.any(String),
      });
      expect(execute).not.toHaveBeenCalled();
      expect(store.testing.sessionRecords(namespace)).toEqual([]);
      expect(
        await store.state.listWork({ namespace, status: "pending" }),
      ).toEqual([]);
      expect(put).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(mutate).not.toHaveBeenCalled();
    } finally {
      host.dispose();
    }
  });

  it("uses the Session model override instead of the Agent model", async () => {
    const agentExecute = vi.fn<AgentExecutor>(async () => ({
      agentId: "session-turn-model-override",
      output: { reply: "agent" },
      durationMs: 1,
    }));
    const sessionExecute = vi.fn<AgentExecutor>(async () => ({
      agentId: "session-turn-model-override",
      output: { reply: "session" },
      durationMs: 1,
    }));
    const makeModel = (id: string, execute: AgentExecutor) =>
      defineGenerationModel({
        adapter: { id: "test", version: "1" },
        native: Object.freeze({ id }),
        definition: { id: `test:${id}`, fingerprint: `${id}-v1` },
        identity: { kind: "model" as const, model: id },
        capabilities: {
          contract: "crux.generation-capabilities.v1" as const,
          language: ["text-input", "text-output", "structured-output"],
          embedding: [],
          image: [],
          speech: [],
          transcription: [],
        },
        runtime: { createAgentExecutor: () => execute },
      });
    const defaultModel = makeModel("agent-model", agentExecute);
    const overrideModel = makeModel("session-model", sessionExecute);
    const support = agent({
      id: "session-turn-model-override",
      model: defaultModel,
      prompt: prompt({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        prompt: ({ input }) => input.message,
      }),
    });
    const program = createRuntimeProgram({
      targets: [
        {
          target: support,
          definition: {
            id: "agent:session-turn-model-override",
            fingerprint: "v1",
          },
        },
      ],
      generationModels: [defaultModel, overrideModel],
      transports: [],
    });
    const store = inMemoryRuntimeStore();
    const namespace = "session-turn-model-override";
    config({ storage: { records: inMemoryRecordStore() } });
    const host = createWorkHost({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program,
    });
    const worker = createRuntimeWorker({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program,
      pollIntervalMs: 5,
    });

    try {
      const conversation = await host.run(() =>
        session(support, { key: "customer-override", model: overrideModel }),
      );
      expect(
        await (await conversation.send({ message: "Hello" })).result(),
      ).toEqual({ reply: "session" });
      expect(sessionExecute).toHaveBeenCalledOnce();
      expect(agentExecute).not.toHaveBeenCalled();
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("falls back to the Agent model and exposes committed Thread messages after completion", async () => {
    const execute = vi.fn<AgentExecutor>(async (target, options) => {
      const thread = target.prompt.contexts.find(
        (entry) => "_tag" in entry && entry._tag === "Thread",
      );
      if (!thread || thread._tag !== "Thread") {
        throw new Error(
          "Session owner Thread was not bound to the Agent turn.",
        );
      }
      const history = await thread.readHistory();
      const input = options.input as { message: string };
      const output = { reply: `Echo: ${input.message}` };
      const threadCommit = await thread.commitTurn({
        after: history.head,
        messages: [
          { role: "user", content: input.message },
          { role: "assistant", content: output.reply },
        ],
      });
      return {
        agentId: target.id,
        output,
        durationMs: 1,
        threadCommit,
      };
    });
    const model = defineGenerationModel({
      adapter: { id: "test", version: "1" },
      native: Object.freeze({ id: "memory-language-model" }),
      definition: {
        id: "test:memory-language-model",
        fingerprint: "memory-language-model-v1",
      },
      identity: { kind: "model", model: "memory-language-model" },
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
      id: "session-turn-support",
      model,
      prompt: prompt({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        system: "Reply to the customer.",
        prompt: ({ input }) => input.message,
      }),
    });
    const program = createRuntimeProgram({
      targets: [
        {
          target: support,
          definition: {
            id: "agent:session-turn-support",
            fingerprint: "session-turn-support-v1",
          },
        },
      ],
      transports: [],
    });
    const store = inMemoryRuntimeStore();
    const records = inMemoryRecordStore();
    const namespace = "session-turn-execution";
    config({ storage: { records } });
    const host = createWorkHost({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program,
    });
    const worker = createRuntimeWorker({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program,
      pollIntervalMs: 5,
    });

    try {
      const conversation = await host.run(() =>
        session(support, { key: "customer-42" }),
      );
      const turn = await conversation.send({ message: "Hello" });
      const output = await turn.result();
      const work = await store.state.listWork({
        namespace,
        status: "completed",
      });

      expect(output).toEqual({ reply: "Echo: Hello" });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ model }),
      );
      expect(work).toHaveLength(1);
      const turnWork = await turn.work();
      expect(turnWork.id).toBe(work[0]?.workId);
      expect(turnWork.effects).toEqual({
        kind: "effect.scope",
        id: expect.any(String),
        runId: turnWork.id,
      });
      expect(await turnWork.status()).toMatchObject({ state: "completed" });
      expect(await turnWork.result()).toEqual(output);
      expect(await conversation.thread.read()).toMatchObject({
        entries: [
          expect.objectContaining({ role: "user", content: "Hello" }),
          expect.objectContaining({
            role: "assistant",
            content: "Echo: Hello",
          }),
        ],
      });
      expect(
        store.testing.sessionRecord(namespace, conversation.id),
      ).toMatchObject({
        acceptedCursor: 1,
        wakePending: false,
      });
    } finally {
      await worker.stop();
      host.dispose();
    }
  });
});
