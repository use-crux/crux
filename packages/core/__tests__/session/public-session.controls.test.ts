/** Public Session lifecycle controls: close, kill, delete, and fork lineage. */

import { afterEach, describe, expect, it } from "vitest";
import {
  config,
  createWorkHost,
  getSession,
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
import { z } from "zod";
import { defineGenerationModel } from "../../src/adapter-authoring";
import { thread } from "../../src/thread";
import { createThreadHandle } from "../../src/thread/thread";
import { sessionHost, sessionTestModel } from "./public-session.test-support";

afterEach(() => resetHooks());

function supportAgent(id: string) {
  return agent({
    id,
    model: sessionTestModel,
    prompt: prompt({
      input: z.object({ message: z.string() }),
      output: z.object({ reply: z.string() }),
      system: "Reply helpfully.",
    }),
  });
}

describe("public Session lifecycle controls", () => {
  it("close rejects later send while draining accepted pre-barrier input", async () => {
    const support = supportAgent("session-close-vs-send");
    const { host, store, records } = sessionHost("session-close-vs-send", {
      targets: [support],
    });
    try {
      const handle = await host.run(() =>
        session(support, { key: "customer:close" }),
      );
      const accepted = await handle.send({ message: "pre-barrier" });
      // Joinable close waits for drain; seal first, then prove post-barrier rejection.
      const barrier = handle.close();
      await viWaitFor(async () => (await handle.status()).state === "closing");

      await expect(handle.send({ message: "post-barrier" })).rejects.toMatchObject({
        code: "SESSION_CLOSED",
      });
      await expect(handle.status()).resolves.toMatchObject({
        state: "closing",
        pendingInputs: 1,
        acceptedCursor: "1",
      });
      expect(accepted.cursor).toBe("1");
      expect(
        store.testing.sessionRecord("session-close-vs-send", handle.id),
      ).toMatchObject({ state: "closing", acceptedCursor: 1 });
      const control = await records.get(`thread/${handle.thread.id}`);
      expect(control?.owners).toEqual({ [handle.id]: "open" });

      // Kill finishes the joinable barrier without a worker drain.
      await handle.kill();
      await expect(barrier).resolves.toBeUndefined();
    } finally {
      host.dispose();
    }
  });

  it("close of a parked Session becomes closed without a maintenance wake", async () => {
    const support = supportAgent("session-close-parked");
    const { host, store, records } = sessionHost("session-close-parked", {
      targets: [support],
    });
    try {
      const handle = await host.run(() =>
        session(support, { key: "customer:parked-close" }),
      );
      const outboxBefore = await store.outbox.list({
        namespace: "session-close-parked",
        limit: 20,
      });
      await handle.close();
      await expect(handle.status()).resolves.toMatchObject({
        state: "closed",
        pendingInputs: 0,
        pendingWork: 0,
      });
      await expect(handle.send({ message: "too late" })).rejects.toMatchObject({
        code: "SESSION_CLOSED",
      });
      const outboxAfter = await store.outbox.list({
        namespace: "session-close-parked",
        limit: 20,
      });
      expect(outboxAfter).toHaveLength(outboxBefore.length);
      const control = await records.get(`thread/${handle.thread.id}`);
      expect(control?.owners).toEqual({ [handle.id]: "closed" });
      // Idempotent close remains joinable.
      await expect(handle.close()).resolves.toBeUndefined();
    } finally {
      host.dispose();
    }
  });

  it("kill fences late Thread-publishing completion and claim/checkpoint authority", async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let executions = 0;
    let lateCommitError: unknown;
    const model = defineGenerationModel({
      adapter: { id: "test", version: "1" },
      native: Object.freeze({ id: "session-kill-model" }),
      definition: {
        id: "test:session-kill-model",
        fingerprint: "session-kill-v1",
      },
      identity: { kind: "model", model: "session-kill-model" },
      capabilities: {
        contract: "crux.generation-capabilities.v1",
        language: ["text-input", "text-output", "structured-output"],
        embedding: [],
        image: [],
        speech: [],
        transcription: [],
      },
      runtime: {
        createAgentExecutor:
          () =>
          async (target, options): Promise<ReturnType<AgentExecutor>> => {
            executions += 1;
            await providerGate;
            const ownerThread = target.prompt.contexts.find(
              (entry) => "_tag" in entry && entry._tag === "Thread",
            );
            if (!ownerThread || ownerThread._tag !== "Thread") {
              throw new Error("Session owner Thread was not bound.");
            }
            const input = options.input as { message: string };
            try {
              await ownerThread.commitTurn({
                messages: [
                  { role: "user", content: input.message },
                  { role: "assistant", content: "late" },
                ],
              });
            } catch (error) {
              lateCommitError = error;
              throw error;
            }
            return {
              agentId: "session-kill-vs-completion",
              output: { reply: "late" },
              durationMs: 1,
            };
          },
      },
    });
    const support = agent({
      id: "session-kill-vs-completion",
      model,
      prompt: prompt({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        system: "Hold.",
      }),
    });
    const store = inMemoryRuntimeStore();
    const records = inMemoryRecordStore();
    const namespace = "session-kill-vs-completion";
    config({ storage: { records } });
    const program = createRuntimeProgram({
      targets: [support],
      generationModels: [model],
      transports: [],
    });
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
      const handle = await host.run(() =>
        session(support, { key: "customer:kill" }),
      );
      const turn = await handle.send({ message: "in-flight" });
      await viWaitFor(() => executions >= 1);

      await handle.kill();
      await expect(handle.status()).resolves.toMatchObject({
        state: "closed",
      });
      expect(
        store.testing.sessionRecord(namespace, handle.id),
      ).toMatchObject({ state: "killed" });

      const threadBefore = await handle.thread.read();
      expect(threadBefore.entries).toEqual([]);
      releaseProvider();
      await new Promise((resolve) => setTimeout(resolve, 80));
      await expect(handle.thread.read()).resolves.toEqual(threadBefore);
      expect(lateCommitError).toMatchObject({ code: "identity_conflict" });
      await expect(
        store.sessions!.checkpointPreparedExecution({
          namespace,
          sessionId: handle.id,
          inputId: turn.id,
          workId: "work_should_not_checkpoint" as never,
          preparedResultRef: {
            sha256: "0".repeat(64),
            size: 1,
            mediaType: "application/json",
            location: "missing",
          },
          now: new Date(),
        }),
      ).rejects.toThrow(/commit authority/);
      await expect(handle.send({ message: "after-kill" })).rejects.toMatchObject({
        code: "SESSION_CLOSED",
      });
      await expect(turn.result()).rejects.toMatchObject({
        code: "work_cancelled",
      });
      await expect(handle.kill()).resolves.toBeUndefined();
      const control = await records.get(`thread/${handle.thread.id}`);
      expect(control?.owners).toEqual({ [handle.id]: "closed" });
    } finally {
      releaseProvider();
      await worker.stop();
      host.dispose();
    }
  });

  it("delete is retention-safe and only then unblocks Thread deletion", async () => {
    const support = supportAgent("session-delete-owner-safety");
    const { host, records } = sessionHost("session-delete-owner-safety", {
      targets: [support],
    });
    try {
      const handle = await host.run(() =>
        session(support, { key: "customer:delete" }),
      );
      const conversation = thread({ id: handle.thread.id, storage: { records } });

      await expect(conversation.delete()).rejects.toMatchObject({
        code: "in_use",
      });
      await expect(handle.delete()).rejects.toMatchObject({
        code: "SESSION_NOT_CLOSED",
      });

      await handle.close();
      await expect(conversation.delete()).rejects.toMatchObject({
        code: "in_use",
      });
      expect(await records.get(`thread/${handle.thread.id}`)).toMatchObject({
        owners: { [handle.id]: "closed" },
      });

      await handle.delete();
      expect(await records.get(`thread/${handle.thread.id}`)).toMatchObject({
        owners: {},
      });
      // Post-delete Session thread reads must not resurrect owners.
      await expect(handle.thread.read()).resolves.toMatchObject({
        entries: [],
        threadId: handle.thread.id,
      });
      expect(await records.get(`thread/${handle.thread.id}`)).toMatchObject({
        owners: {},
      });
      await expect(conversation.delete()).resolves.toBeUndefined();
      await expect(handle.delete()).resolves.toBeUndefined();

      await expect(
        host.run(() => session(support, { key: "customer:delete" })),
      ).rejects.toMatchObject({ code: "SESSION_TOMBSTONED" });
      await expect(
        host.run(() => getSession(support, "customer:delete")),
      ).rejects.toMatchObject({ code: "SESSION_DELETED" });
    } finally {
      host.dispose();
    }
  });

  it("close concurrent with turn completion ends closed with drained counters", async () => {
    const model = defineGenerationModel({
      adapter: { id: "test", version: "1" },
      native: Object.freeze({ id: "session-close-race-model" }),
      definition: {
        id: "test:session-close-race-model",
        fingerprint: "session-close-race-v1",
      },
      identity: { kind: "model", model: "session-close-race-model" },
      capabilities: {
        contract: "crux.generation-capabilities.v1",
        language: ["text-input", "text-output", "structured-output"],
        embedding: [],
        image: [],
        speech: [],
        transcription: [],
      },
      runtime: {
        createAgentExecutor: () => async () => ({
          agentId: "session-close-race",
          output: { reply: "done" },
          durationMs: 1,
        }),
      },
    });
    const support = agent({
      id: "session-close-race",
      model,
      prompt: prompt({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        system: "Race.",
      }),
    });
    const store = inMemoryRuntimeStore();
    const records = inMemoryRecordStore();
    const namespace = "session-close-race";
    config({ storage: { records } });
    const program = createRuntimeProgram({
      targets: [support],
      generationModels: [model],
      transports: [],
    });
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
      const handle = await host.run(() =>
        session(support, { key: "customer:close-race" }),
      );
      const turn = await handle.send({ message: "race" });
      await Promise.all([handle.close(), turn.result()]);
      await expect(handle.status()).resolves.toMatchObject({
        state: "closed",
        pendingInputs: 0,
        pendingWork: 0,
      });
      expect(store.testing.sessionRecord(namespace, handle.id)).toMatchObject({
        state: "closed",
        pendingInputs: 0,
        pendingWork: 0,
      });
    } finally {
      await worker.stop();
      host.dispose();
    }
  });

  it("kill retries cancel residual Work after partial cancel failure", async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let executions = 0;
    const model = defineGenerationModel({
      adapter: { id: "test", version: "1" },
      native: Object.freeze({ id: "session-kill-retry-model" }),
      definition: {
        id: "test:session-kill-retry-model",
        fingerprint: "session-kill-retry-v1",
      },
      identity: { kind: "model", model: "session-kill-retry-model" },
      capabilities: {
        contract: "crux.generation-capabilities.v1",
        language: ["text-input", "text-output", "structured-output"],
        embedding: [],
        image: [],
        speech: [],
        transcription: [],
      },
      runtime: {
        createAgentExecutor: () => async () => {
          executions += 1;
          await providerGate;
          return {
            agentId: "session-kill-retry",
            output: { reply: "late" },
            durationMs: 1,
          };
        },
      },
    });
    const support = agent({
      id: "session-kill-retry",
      model,
      prompt: prompt({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        system: "Hold.",
      }),
    });
    const store = inMemoryRuntimeStore();
    const records = inMemoryRecordStore();
    const namespace = "session-kill-retry";
    config({ storage: { records } });
    const program = createRuntimeProgram({
      targets: [support],
      generationModels: [model],
      transports: [],
    });
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
      const handle = await host.run(() =>
        session(support, { key: "customer:kill-retry" }),
      );
      const turn = await handle.send({ message: "in-flight" });
      await viWaitFor(() => executions >= 1);

      // Simulate crash after Session fence but before Work cancellation.
      await store.transact(async (tx) => {
        await tx.sessions!.kill!({
          namespace,
          sessionId: handle.id,
          now: new Date(),
        });
      });
      expect(store.testing.sessionRecord(namespace, handle.id)).toMatchObject({
        state: "killed",
      });
      expect(
        store.testing.sessionRecord(namespace, handle.id)?.fencedWorkId,
      ).toBeTruthy();
      const active = await store.state.listWork({ namespace, status: "leased" });
      expect(active.length).toBeGreaterThan(0);

      // Retry completes cancellation and owner close.
      await handle.kill();
      releaseProvider();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await expect(turn.result()).rejects.toMatchObject({
        code: "work_cancelled",
      });
      const control = await records.get(`thread/${handle.thread.id}`);
      expect(control?.owners).toEqual({ [handle.id]: "closed" });
    } finally {
      releaseProvider();
      await worker.stop();
      host.dispose();
    }
  });

  it("fork rejects a deleted child tombstone at the same pinned boundary", async () => {
    const support = supportAgent("session-fork-tombstone");
    const { host } = sessionHost("session-fork-tombstone", {
      targets: [support],
    });
    try {
      const parent = await host.run(() =>
        session(support, { key: "customer:fork-tombstone" }),
      );
      const child = await parent.fork();
      await child.close();
      await child.delete();
      await expect(parent.fork()).rejects.toMatchObject({
        code: "SESSION_TOMBSTONED",
      });
      await expect(parent.forks()).resolves.toEqual([]);
    } finally {
      host.dispose();
    }
  });

  it("fork pins an independent owner head from the source revision", async () => {
    const support = supportAgent("session-fork-head");
    const { host, records } = sessionHost("session-fork-head", {
      targets: [support],
    });
    try {
      const parent = await host.run(() =>
        session(support, { key: "customer:fork-parent" }),
      );
      const parentOwner = createThreadHandle(
        { id: parent.thread.id, storage: { records } },
        { id: parent.id, state: "open" },
      );
      await parentOwner.append({
        id: "parent-msg-1",
        role: "user",
        content: "shared-root",
      });
      const parentBefore = await parent.thread.read();
      expect(parentBefore.entries.map((entry) => entry.id)).toEqual([
        "parent-msg-1",
      ]);

      const child = await parent.fork();
      expect(child.id).not.toBe(parent.id);
      expect(child.forkedFrom).toMatchObject({
        sessionId: parent.id,
        cursor: "0",
        threadRevision: parentBefore.revision,
      });
      await expect(child.thread.read()).resolves.toMatchObject({
        entries: [{ id: "parent-msg-1" }],
      });
      await expect(parent.forks()).resolves.toEqual([
        expect.objectContaining({ sessionId: child.id }),
      ]);

      await parentOwner.append({
        id: "parent-msg-2",
        role: "assistant",
        content: "parent-only",
      });
      await expect(parent.thread.read()).resolves.toMatchObject({
        entries: [{ id: "parent-msg-1" }, { id: "parent-msg-2" }],
      });
      // Child head remains pinned; it never aliases the mutable parent head.
      await expect(child.thread.read()).resolves.toMatchObject({
        entries: [{ id: "parent-msg-1" }],
      });

      const control = await records.get(`thread/${parent.thread.id}`);
      expect(control?.owners).toMatchObject({
        [parent.id]: "open",
        [child.id]: "open",
      });
      expect(control?.heads[parent.id]).toBe("parent-msg-2");
      expect(control?.heads[child.id]).toBe("parent-msg-1");

      await expect(child.send({ message: "child-ingress" })).resolves.toMatchObject({
        cursor: "1",
      });
    } finally {
      host.dispose();
    }
  });

  it("fork recovers after owner registration when Session fork persistence fails", async () => {
    const support = supportAgent("session-fork-recovery");
    const baseStore = inMemoryRuntimeStore();
    // Frozen stores cannot be patched; wrap transact for fault injection.
    let failOnce = true;
    const store = {
      ...baseStore,
      async transact<T>(
        fn: Parameters<typeof baseStore.transact<T>>[0],
      ): Promise<T> {
        return baseStore.transact(async (tx) => {
          if (tx.sessions?.fork) {
            const originalFork = tx.sessions.fork.bind(tx.sessions);
            Object.assign(tx.sessions, {
              fork: async (
                input: Parameters<NonNullable<typeof originalFork>>[0],
              ) => {
                if (failOnce) {
                  failOnce = false;
                  throw new Error(
                    "crash between owner registration and fork persistence",
                  );
                }
                return originalFork(input);
              },
            });
          }
          return fn(tx);
        });
      },
    };
    const records = inMemoryRecordStore();
    const namespace = "session-fork-recovery";
    config({ storage: { records } });
    const host = createWorkHost({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program: createRuntimeProgram({
        targets: [support],
        generationModels: [sessionTestModel],
        transports: [],
      }),
    });
    try {
      const parent = await host.run(() =>
        session(support, { key: "customer:fork-recovery" }),
      );
      const parentOwner = createThreadHandle(
        { id: parent.thread.id, storage: { records } },
        { id: parent.id, state: "open" },
      );
      await parentOwner.append({
        id: "recovery-root",
        role: "user",
        content: "root",
      });

      await expect(parent.fork()).rejects.toThrow(
        /crash between owner registration and fork persistence/,
      );
      const controlAfterCrash = await records.get(`thread/${parent.thread.id}`);
      const childOwners = Object.keys(controlAfterCrash?.owners ?? {}).filter(
        (id) => id !== parent.id,
      );
      expect(childOwners).toHaveLength(1);
      await expect(
        thread({ id: parent.thread.id, storage: { records } }).delete(),
      ).rejects.toMatchObject({ code: "in_use" });

      const child = await parent.fork();
      expect(child.id).toBe(childOwners[0]);
      expect(child.forkedFrom?.sessionId).toBe(parent.id);
      await expect(child.thread.read()).resolves.toMatchObject({
        entries: [{ id: "recovery-root" }],
      });
      await expect(parent.forks()).resolves.toEqual([
        expect.objectContaining({ sessionId: child.id }),
      ]);
    } finally {
      host.dispose();
    }
  });

  it("close then drain settles to closed and is restart-safe", async () => {
    const support = supportAgent("session-close-drain-restart");
    const store = inMemoryRuntimeStore();
    const records = inMemoryRecordStore();
    const namespace = "session-close-drain-restart";
    const model = defineGenerationModel({
      adapter: { id: "test", version: "1" },
      native: Object.freeze({ id: "session-close-drain-model" }),
      definition: {
        id: "test:session-close-drain-model",
        fingerprint: "session-close-drain-v1",
      },
      identity: { kind: "model", model: "session-close-drain-model" },
      capabilities: {
        contract: "crux.generation-capabilities.v1",
        language: ["text-input", "text-output", "structured-output"],
        embedding: [],
        image: [],
        speech: [],
        transcription: [],
      },
      runtime: {
        createAgentExecutor: () => async () => ({
          agentId: "session-close-drain-restart",
          output: { reply: "done" },
          durationMs: 1,
        }),
      },
    });
    const agentTarget = agent({
      id: "session-close-drain-restart",
      model,
      prompt: prompt({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        system: "Drain.",
      }),
    });
    config({ storage: { records } });
    const program = createRuntimeProgram({
      targets: [agentTarget],
      generationModels: [model],
      transports: [],
    });
    const host = createWorkHost({
      runtime: node({ store, namespace, autoStartMaintenance: false }),
      program,
    });
    try {
      const handle = await host.run(() =>
        session(agentTarget, { key: "customer:drain" }),
      );
      const turn = await handle.send({ message: "drain-me" });
      const worker = createRuntimeWorker({
        runtime: node({ store, namespace, autoStartMaintenance: false }),
        program,
        pollIntervalMs: 5,
      });
      const closing = handle.close();
      await expect(turn.result()).resolves.toEqual({ reply: "done" });
      await expect(closing).resolves.toBeUndefined();
      await worker.stop();

      // Restart host sees durable closed state.
      const restarted = createWorkHost({
        runtime: node({ store, namespace, autoStartMaintenance: false }),
        program,
      });
      try {
        const reopened = await restarted.run(() =>
          getSession(agentTarget, "customer:drain"),
        );
        await expect(reopened.status()).resolves.toMatchObject({
          state: "closed",
        });
        await expect(
          reopened.send({ message: "nope" }),
        ).rejects.toMatchObject({ code: "SESSION_CLOSED" });
      } finally {
        restarted.dispose();
      }
    } finally {
      host.dispose();
    }
  });
});

async function viWaitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
