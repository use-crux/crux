/** Agent Session Signal ingress, streams, and bounded input statistics. */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  config,
  createWorkHost,
  flow,
  prompt,
  resetHooks,
  session,
  signal,
} from "@use-crux/core";
import { agent, type AgentExecutor } from "@use-crux/core/agent";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  inMemoryRuntimeStore,
  node,
  type InMemoryRuntimeStore,
} from "@use-crux/core/runtime";
import { inMemoryRecordStore } from "@use-crux/core/storage";
import { z } from "zod";
import { defineGenerationModel } from "../../src/adapter-authoring";
import { managedGenerationStepBoundary } from "../../src/generation-model/execution-checkpoint";
import { signalIngressInputId } from "../../src/runtime/engine/composites/signal-session-ingress";
import { sessionSubscriptionDeliveryId } from "../../src/runtime/reactive/identity";

afterEach(() => {
  resetHooks();
});

describe("Agent Session Signal ingress and streams", () => {
  it("activates a parked Agent Session from a durable Signal subscription", async () => {
    const fixture = await createAgentSignalFixture("parked-activation");
    const worker = fixture.startWorker();
    try {
      // Prove the worker can complete a normal send first.
      const direct = await fixture.conversation.send({ message: "warmup" });
      await expect(direct.result()).resolves.toEqual({ reply: "Echo: warmup" });
      expect(fixture.execute.mock.calls.length).toBeGreaterThan(0);

      const subscription = await fixture.host.run(() =>
        fixture.conversation.subscribe(fixture.tick),
      );
      expect(subscription.signalId).toBe("agent-signal.parked-activation");

      const receipt = await fixture.tick.publish(
        { message: "from-signal" },
        { idempotencyKey: "parked-1" },
      );
      expect(receipt.guarantee).toBe("durable");

      await expect
        .poll(async () => (await fixture.conversation.status()).acceptedCursor)
        .toBe("2");
      await expect(fixture.conversation.stats()).resolves.toMatchObject({
        inputs: {
          total: {
            accepted: 2,
            resumed: 2,
            deduplicated: 0,
            dropped: 0,
          },
          identityAttribution: "complete",
        },
      });

      await expect
        .poll(async () => fixture.execute.mock.calls.length, {
          timeout: 10_000,
        })
        .toBeGreaterThan(1);
      await expect
        .poll(async () => (await fixture.conversation.status()).state, {
          timeout: 10_000,
        })
        .toBe("parked");
      await expect(fixture.conversation.stats()).resolves.toMatchObject({
        work: { total: { completed: 2 } },
        inputs: { total: { delivered: 2 } },
      });
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });

  it(
    "defers mid-turn Signal ingress until the next provider boundary",
    { timeout: 15_000 },
    async () => {
      // Pause after the first safe boundary claim so Signal can queue without
      // mutating the in-flight step. Uses the Session step-boundary hook rather
      // than a full adapter loop (which is covered by recovery suite).
      const gate = deferred();
      let boundaryCalls = 0;
      const fixture = await createAgentSignalFixture("mid-turn", {
        multiStep: true,
        onStepBoundary: async () => {
          boundaryCalls += 1;
          if (boundaryCalls === 1) await gate.pause();
        },
      });
      const worker = fixture.startWorker();
      try {
        await Promise.race([
          gate.started,
          sleep(8_000).then(() => {
            throw new Error(
              `Step boundary never reached (boundaryCalls=${boundaryCalls}, execute=${fixture.execute.mock.calls.length})`,
            );
          }),
        ]);
        expect(boundaryCalls).toBe(1);

        await fixture.conversation.subscribe(fixture.tick);
        const receipt = await fixture.tick.publish({ message: "steering" });
        expect(receipt.guarantee).toBe("durable");

        // Publish only queues a pending delivery; validation/accept waits for
        // the next safe boundary (or worker settle) with program Agent schema.
        await expect(fixture.conversation.status()).resolves.toMatchObject({
          state: "running",
          acceptedCursor: "1",
          pendingInputs: 1,
        });
        // Still paused inside the active turn — only one boundary claim so far.
        expect(boundaryCalls).toBe(1);

        gate.release();
        await expect(fixture.turn!.result()).resolves.toMatchObject({
          reply: expect.stringContaining("Echo:"),
        });
        // Second boundary settled the Signal and claimed both inputs.
        expect(boundaryCalls).toBeGreaterThanOrEqual(2);
        await expect(fixture.conversation.stats()).resolves.toMatchObject({
          inputs: {
            total: { accepted: 2, delivered: 2 },
          },
        });
      } finally {
        gate.release();
        await worker.stop();
        fixture.host.dispose();
      }
    },
  );

  it("deduplicates the same Session-subscription delivery identity on replay", async () => {
    const fixture = await createAgentSignalFixture("dedup");
    const worker = fixture.startWorker();
    try {
      await fixture.host.run(() =>
        fixture.conversation.subscribe(fixture.tick),
      );
      await fixture.tick.publish(
        { message: "once" },
        { idempotencyKey: "same-key" },
      );
      await fixture.tick.publish(
        { message: "once" },
        { idempotencyKey: "same-key" },
      );

      await expect
        .poll(async () => (await fixture.conversation.status()).acceptedCursor, {
          timeout: 10_000,
        })
        .toBe("1");
      // One accepted input despite dual publish of the same occurrence.
      await expect(fixture.conversation.status()).resolves.toMatchObject({
        acceptedCursor: "1",
      });
      const stats = await fixture.conversation.stats();
      expect(stats.inputs.total.accepted).toBe(1);
      // Worker settle after prior accept counts as deduplicated when replayed.
      expect(
        stats.inputs.total.deduplicated + stats.inputs.total.accepted,
      ).toBeGreaterThanOrEqual(1);
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });

  it("persists accepted → delivered → status stream events without duplicate retries", async () => {
    const fixture = await createAgentSignalFixture("stream-order");
    const worker = fixture.startWorker();
    try {
      const turn = await fixture.conversation.send({ message: "hello" });
      await expect(turn.result()).resolves.toEqual({ reply: "Echo: hello" });
      await fixture.conversation.close();

      const streamName = `crux.session:${fixture.conversation.id}`;
      const page = await fixture.store.events.read({
        namespace: fixture.namespace,
        name: streamName,
        limit: 100,
      });
      const types = page.events.map(
        (event) => (event.payload as { type?: string }).type,
      );
      expect(types).toContain("ingress.accepted");
      expect(types).toContain("ingress.delivered");
      expect(types).toContain("session.status");
      const acceptedAt = types.indexOf("ingress.accepted");
      const deliveredAt = types.indexOf("ingress.delivered");
      const statusAt = types.lastIndexOf("session.status");
      expect(acceptedAt).toBeGreaterThanOrEqual(0);
      expect(deliveredAt).toBeGreaterThan(acceptedAt);
      expect(statusAt).toBeGreaterThan(deliveredAt);

      // Idempotent close retry must not duplicate the closed status event.
      await fixture.conversation.close();
      const afterRetry = await fixture.store.events.read({
        namespace: fixture.namespace,
        name: streamName,
        limit: 100,
      });
      const closedStatuses = afterRetry.events.filter((event) => {
        const payload = event.payload as {
          type?: string;
          status?: { state?: string };
        };
        return (
          payload.type === "session.status" &&
          payload.status?.state === "closed"
        );
      });
      expect(closedStatuses).toHaveLength(1);

      // Live stream: snapshot then retained history in durable order.
      const liveTypes: string[] = [];
      for await (const event of fixture.conversation.stream()) {
        liveTypes.push(event.type);
        if (event.type === "session.status" && event.status.state === "closed") {
          break;
        }
      }
      expect(liveTypes[0]).toBe("session.snapshot");
      expect(liveTypes).toContain("ingress.accepted");
      expect(liveTypes).toContain("ingress.delivered");
      expect(liveTypes.at(-1)).toBe("session.status");

      // Valid reconnect resumes strictly after the accepted event.
      const accepted = afterRetry.events.find(
        (event) =>
          (event.payload as { type?: string }).type === "ingress.accepted",
      )!;
      const resumedTypes: string[] = [];
      for await (const event of fixture.conversation.stream({
        after: accepted.eventId,
      })) {
        resumedTypes.push(event.type);
        if (event.type === "session.status" && event.status.state === "closed") {
          break;
        }
      }
      expect(resumedTypes[0]).not.toBe("session.snapshot");
      expect(resumedTypes).toContain("ingress.delivered");
      expect(resumedTypes).not.toContain("ingress.accepted");
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });

  it("replays from earliest retained event after an expired cursor", async () => {
    const fixture = await createAgentSignalFixture("stream-expired");
    const worker = fixture.startWorker();
    try {
      const turn = await fixture.conversation.send({ message: "hello" });
      await expect(turn.result()).resolves.toEqual({ reply: "Echo: hello" });
      const streamName = `crux.session:${fixture.conversation.id}`;
      const before = await fixture.store.events.read({
        namespace: fixture.namespace,
        name: streamName,
        limit: 100,
      });
      const after = before.events[0]!.eventId;

      await fixture.store.events.prune({
        namespace: fixture.namespace,
        before: new Date(Date.now() + 60_000),
        limit: 1000,
      });
      // Append a new retained event after the gap.
      await fixture.conversation.close();

      const types: string[] = [];
      for await (const event of fixture.conversation.stream({ after })) {
        types.push(event.type);
        if (event.type === "session.status" && event.status.state === "closed") {
          break;
        }
      }
      expect(types[0]).toBe("session.snapshot");
      expect(
        (await collectFirst(fixture.conversation.stream({ after }))).reason,
      ).toBe("cursor-expired");
      // Continues from earliest retained (close status), not empty.
      expect(types).toContain("session.status");
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });

  it("reports bounded first-64 identity coverage for Session input stats", async () => {
    const fixture = await createAgentSignalFixture("stats-64");
    try {
      for (let index = 0; index < 65; index += 1) {
        await fixture.conversation.send({ message: `m-${index}` });
      }
      const stats = await fixture.conversation.stats();
      expect(stats.inputs.total.accepted).toBe(65);
      expect(Object.keys(stats.inputs.byIdentity)).toHaveLength(64);
      expect(stats.inputs.identityAttribution).toBe("truncated");
      expect(stats.inputs.otherIdentities?.accepted).toBe(1);
    } finally {
      fixture.host.dispose();
    }
  });

  it("excludes closed and killed Sessions from Signal delivery", async () => {
    const fixture = await createAgentSignalFixture("lifecycle-exclude");
    try {
      await fixture.host.run(() =>
        fixture.conversation.subscribe(fixture.tick),
      );
      await fixture.conversation.close();
      await expect(fixture.conversation.subscriptions()).resolves.toEqual([]);
      const receipt = await fixture.tick.publish({ message: "after-close" });
      // No durable consumer remains after close deactivates subscriptions.
      expect(receipt.guarantee).toBe("process-local");
      await expect(fixture.conversation.status()).resolves.toMatchObject({
        state: "closed",
        pendingInputs: 0,
      });
      await expect(fixture.conversation.stats()).resolves.toMatchObject({
        inputs: { total: { accepted: 0 } },
      });

      const killed = await createAgentSignalFixture("lifecycle-kill");
      try {
        await killed.host.run(() => killed.conversation.subscribe(killed.tick));
        await killed.conversation.kill();
        const killedReceipt = await killed.tick.publish({
          message: "after-kill",
        });
        expect(killedReceipt.guarantee).toBe("process-local");
        await expect(killed.conversation.status()).resolves.toMatchObject({
          state: "closed",
          pendingInputs: 0,
        });
      } finally {
        killed.host.dispose();
      }
    } finally {
      fixture.host.dispose();
    }
  });

  it("rejects Signal payloads that fail the Agent Prompt input schema before accept", async () => {
    const fixture = await createAgentSignalFixture("schema-reject", {
      // Signal schema is intentionally looser than the Agent Prompt schema.
      signalSchema: z.object({
        message: z.string().optional(),
        extra: z.string().optional(),
      }),
    });
    const worker = fixture.startWorker();
    try {
      const subs = await fixture.host.run(async () => {
        await fixture.conversation.subscribe(fixture.tick);
        return fixture.conversation.subscriptions();
      });
      expect(subs).toHaveLength(1);
      // JSON object passes the object gate but fails Agent message: string.
      const receipt = await fixture.tick.publish({ extra: "nope" });
      expect(receipt.guarantee).toBe("durable");

      // Occurrence + pending delivery accepted; worker drops without accept/wake.
      await expect
        .poll(async () => (await fixture.conversation.stats()).inputs.total.dropped, {
          timeout: 10_000,
        })
        .toBe(1);
      await expect(fixture.conversation.status()).resolves.toMatchObject({
        state: "parked",
        pendingInputs: 0,
      });
      expect((await fixture.conversation.status()).acceptedCursor).toBeUndefined();
      const stats = await fixture.conversation.stats();
      expect(stats.inputs.total.accepted).toBe(0);
      expect(stats.inputs.total.resumed).toBe(0);
      const deliveryId = sessionSubscriptionDeliveryId(
        receipt.occurrenceId,
        subs[0]!.id,
      );
      const expectedIdentity = signalIngressInputId(deliveryId);
      expect(stats.inputs.byIdentity[expectedIdentity]?.dropped).toBe(1);
      expect(stats.inputs.byIdentity[deliveryId]).toBeUndefined();
      // Dropped Signal never starts a Session turn (no accepted inputs).
      expect(stats.inputs.total.accepted).toBe(0);
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });

  it("accepts Signal occurrence without a process-global schema registry (worker validates)", async () => {
    // Publish uses only store-backed occurrence/delivery acceptance. The
    // immutable worker program supplies the Agent schema at settle time.
    const fixture = await createAgentSignalFixture("fresh-authority");
    const worker = fixture.startWorker();
    try {
      await fixture.host.run(() =>
        fixture.conversation.subscribe(fixture.tick),
      );
      const receipt = await fixture.tick.publish({ message: "via-worker" });
      expect(receipt.guarantee).toBe("durable");
      await expect
        .poll(async () => (await fixture.conversation.status()).acceptedCursor, {
          timeout: 10_000,
        })
        .toBe("1");
      await expect
        .poll(async () => (await fixture.conversation.status()).state, {
          timeout: 10_000,
        })
        .toBe("parked");
      await expect(fixture.conversation.stats()).resolves.toMatchObject({
        inputs: { total: { accepted: 1, resumed: 1 } },
      });
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });

  it("uses signalIngressInputId for every Signal ingress stats identity", () => {
    const deliveryId = sessionSubscriptionDeliveryId("occ_1", "sub_1");
    const identity = signalIngressInputId(deliveryId);
    expect(identity).toBe(`input_sig_${deliveryId}`);
    expect(identity).not.toBe(deliveryId);
    expect(identity.startsWith("input_sig_")).toBe(true);
  });

  it(
    "keeps Agent Signal-ingress Work pending when temporary publish also resumes a Flow waiter",
    { timeout: 20_000 },
    async () => {
      // Mixed consumers: one counted Flow waiter + one Agent Session subscription.
      // Temporary publish must nudge the Flow without terminalizing Agent ingress
      // (missing Agent target on the temporary dispatcher is requeueable).
      const fixture = await createAgentSignalFixture("mixed-temp-publish");
      const resumed = promiseGate();
      const finishFlow = promiseGate();
      const flowDone = promiseGate();
      const waiter = flow(
        "mixed-temp-publish-waiter",
        { signals: { tick: fixture.tick } },
        async (scope) => {
          await scope.waitFor(fixture.tick);
          resumed.resolve();
          await finishFlow.promise;
          flowDone.resolve();
        },
      );

      try {
        const suspended = await waiter.run({
          flowId: "flow_mixed_temp_publish",
        });
        expect(suspended.status).toBe("suspended");

        await fixture.host.run(() =>
          fixture.conversation.subscribe(fixture.tick),
        );

        const receipt = await fixture.tick.publish(
          { message: "shared-occurrence" },
          { idempotencyKey: "mixed-1" },
        );
        expect(receipt.guarantee).toBe("durable");

        // Flow resume runs on the temporary publish dispatcher (process registry).
        await resumed.promise;

        // Agent ingress Work must remain pending/retryable — never blocked or
        // terminalized by the temporary missing-target path.
        await expect
          .poll(async () => {
            const pending = await fixture.store.state.listWork({
              namespace: fixture.namespace,
              status: "pending",
              kind: "session.signal-ingress",
              limit: 20,
            });
            const blocked = await fixture.store.state.listWork({
              namespace: fixture.namespace,
              status: "blocked",
              kind: "session.signal-ingress",
              limit: 20,
            });
            const dead = await fixture.store.state.listWork({
              namespace: fixture.namespace,
              status: "dead-letter",
              kind: "session.signal-ingress",
              limit: 20,
            });
            return {
              pending: pending.length,
              blocked: blocked.length,
              dead: dead.length,
            };
          })
          .toEqual({ pending: 1, blocked: 0, dead: 0 });

        // Program worker owns Agent schema authority and settles exactly once.
        const worker = fixture.startWorker();
        try {
          await expect
            .poll(
              async () => (await fixture.conversation.status()).acceptedCursor,
              { timeout: 10_000 },
            )
            .toBe("1");
          await expect
            .poll(
              async () => (await fixture.conversation.status()).state,
              { timeout: 10_000 },
            )
            .toBe("parked");
          await expect(fixture.conversation.stats()).resolves.toMatchObject({
            inputs: { total: { accepted: 1, resumed: 1, dropped: 0 } },
          });

          const terminal = await fixture.store.state.listWork({
            namespace: fixture.namespace,
            status: "completed",
            kind: "session.signal-ingress",
            limit: 20,
          });
          expect(terminal).toHaveLength(1);

          finishFlow.resolve();
          await flowDone.promise;
        } finally {
          await worker.stop();
        }
      } finally {
        finishFlow.resolve();
        fixture.host.dispose();
      }
    },
  );
});

async function createAgentSignalFixture(
  id: string,
  options: {
    readonly multiStep?: boolean;
    readonly onStepBoundary?: () => Promise<void>;
    readonly signalSchema?: z.ZodType;
  } = {},
) {
  const execute = vi.fn<AgentExecutor>(async (target, execOptions) => {
    const boundary = execOptions[managedGenerationStepBoundary];
    if (boundary) {
      await boundary({ stepIndex: 0, reason: "initial" });
      if (options.onStepBoundary) await options.onStepBoundary();
      // Second declared safe boundary: newly accepted Signal inputs become
      // model-visible here without mutating the first sealed claim.
      if (options.multiStep) {
        await boundary({ stepIndex: 1, reason: "tool-result" });
        if (options.onStepBoundary) await options.onStepBoundary();
      }
    }
    const input = execOptions.input as { message: string };
    return {
      agentId: target.id,
      output: { reply: `Echo: ${input.message}` },
      durationMs: 1,
    };
  });
  const model = defineGenerationModel({
    adapter: { id: "test", version: "1" },
    native: Object.freeze({ id: "agent-signal-model" }),
    definition: {
      id: `test:agent-signal-model:${id}`,
      fingerprint: "agent-signal-v1",
    },
    identity: { kind: "model", model: `agent-signal-${id}` },
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
  const tick = signal({
    id: `agent-signal.${id}`,
    schema: options.signalSchema ?? z.object({ message: z.string() }),
  });
  const support = agent({
    id: `agent-signal-support-${id}`,
    model,
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
        definition: { id: `agent:agent-signal:${id}`, fingerprint: "v1" },
      },
    ],
    generationModels: [model],
    transports: [],
  });
  const store = Object.freeze({
    ...inMemoryRuntimeStore(),
    durability: "durable" as const,
  }) as InMemoryRuntimeStore;
  const records = inMemoryRecordStore();
  const namespace = `agent-signal-${id}`;
  const hostRuntime = node({ store, namespace, autoStartMaintenance: false });
  // Register storage + runtime so Signal.publish resolves durable consumers.
  config({ storage: { records }, runtime: hostRuntime });
  const host = createWorkHost({
    runtime: hostRuntime,
    program,
  });
  const conversation = await host.run(() =>
    session(support, { key: `customer-${id}` }),
  );
  let turn:
    | Awaited<ReturnType<typeof conversation.send>>
    | undefined;
  if (options.multiStep) {
    turn = await conversation.send({ message: "Hello" });
  }
  return {
    conversation,
    execute,
    host,
    namespace,
    store,
    tick,
    turn,
    startWorker: () =>
      createRuntimeWorker({
        runtime: node({ store, namespace, autoStartMaintenance: false }),
        program,
        pollIntervalMs: 1,
      }),
  };
}

function deferred() {
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const pause = () =>
    new Promise<void>((resolve) => {
      markStarted();
      release = resolve;
    });
  return {
    started,
    pause,
    release: () => release?.(),
  };
}

function promiseGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return {
    promise,
    resolve: () => resolve(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectFirst<T>(
  iterable: AsyncIterable<T>,
): Promise<T & { reason?: string }> {
  for await (const value of iterable) {
    return value as T & { reason?: string };
  }
  throw new Error("empty stream");
}
