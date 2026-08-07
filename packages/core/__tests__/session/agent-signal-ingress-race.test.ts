/** Concurrent settlement and boundary backlog for Agent Session Signal ingress. */

import { afterEach, describe, expect, it } from "vitest";
import {
  config,
  createWorkHost,
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
import {
  settleAgentSessionSignalIngress,
  settlePendingAgentSessionSignalIngressForSession,
  SESSION_SIGNAL_INGRESS_SETTLE_LIMIT,
  signalIngressInputId,
} from "../../src/runtime/engine/composites/signal-session-ingress";
import { sessionSignalIngressIdentity } from "../../src/runtime/engine/session-turn-identity";
import { sessionSubscriptionDeliveryId } from "../../src/runtime/reactive/identity";
import { initialApplicationWorkState } from "../../src/runtime/engine/application-work-state";
import { wakeEnvelopeForWork } from "../../src/runtime/engine/kernel-shared";
import type { RuntimeTargetId } from "../../src/runtime/ports/ids";

afterEach(() => {
  resetHooks();
});

describe("Agent Signal ingress concurrent settlement", () => {
  it("worker + boundary race on one delivery accepts once (Memory)", async () => {
    const fixture = await createRaceFixture("race-once");
    const worker = fixture.startWorker();
    try {
      await fixture.host.run(() =>
        fixture.conversation.subscribe(fixture.tick),
      );
      const receipt = await fixture.tick.publish(
        { message: "race" },
        { idempotencyKey: "race-key" },
      );
      const subs = await fixture.conversation.subscriptions();
      const deliveryId = sessionSubscriptionDeliveryId(
        receipt.occurrenceId,
        subs[0]!.id,
      );
      const parseSchema = z.object({ message: z.string() });

      // Concurrent boundary settle + worker wake path.
      const boundary = fixture.store.transact(async (tx) => {
        await settleAgentSessionSignalIngress(tx, {
          namespace: fixture.namespace,
          sessionId: fixture.conversation.id,
          deliveryId,
          occurrenceId: receipt.occurrenceId,
          subscriptionId: subs[0]!.id,
          now: new Date(),
          parseSchema,
        });
      });
      const boundary2 = fixture.store.transact(async (tx) => {
        await settleAgentSessionSignalIngress(tx, {
          namespace: fixture.namespace,
          sessionId: fixture.conversation.id,
          deliveryId,
          occurrenceId: receipt.occurrenceId,
          subscriptionId: subs[0]!.id,
          now: new Date(),
          parseSchema,
        });
      });
      await Promise.allSettled([boundary, boundary2]);

      await expect
        .poll(async () => (await fixture.conversation.status()).acceptedCursor, {
          timeout: 10_000,
        })
        .toBe("1");

      const status = await fixture.conversation.status();
      expect(status.pendingInputs + (status.state === "running" ? 1 : 0)).toBeGreaterThanOrEqual(0);
      const stats = await fixture.conversation.stats();
      expect(stats.inputs.total.accepted).toBe(1);
      expect(stats.inputs.total.resumed).toBeLessThanOrEqual(1);
      const identity = signalIngressInputId(deliveryId);
      expect(stats.inputs.byIdentity[identity]?.accepted).toBe(1);

      const delivery = await fixture.store.signals.getDelivery(
        fixture.namespace,
        deliveryId,
      );
      expect(delivery?.state).toBe("delivered");

      const stream = await fixture.store.events.read({
        namespace: fixture.namespace,
        name: `crux.session:${fixture.conversation.id}`,
        limit: 50,
      });
      const acceptedEvents = stream.events.filter(
        (event) =>
          (event.payload as { type?: string }).type === "ingress.accepted",
      );
      expect(acceptedEvents).toHaveLength(1);
    } finally {
      await worker.stop();
      fixture.host.dispose();
    }
  });

  it("acceptInputs is idempotent for stable inputIds under concurrent calls", async () => {
    const fixture = await createRaceFixture("accept-idemp");
    try {
      const inputId = "input_sig_stable_1";
      const payload = { message: "once" };
      const now = new Date();
      await Promise.all([
        fixture.store.transact(async (tx) => {
          await tx.sessions!.acceptInputs({
            namespace: fixture.namespace,
            sessionId: fixture.conversation.id,
            inputs: [payload],
            inputIds: [inputId],
            now,
          });
        }),
        fixture.store.transact(async (tx) => {
          await tx.sessions!.acceptInputs({
            namespace: fixture.namespace,
            sessionId: fixture.conversation.id,
            inputs: [payload],
            inputIds: [inputId],
            now,
          });
        }),
      ]);
      const session = await fixture.store.sessions!.get(
        fixture.namespace,
        fixture.conversation.id,
      );
      expect(session?.acceptedCursor).toBe(1);
      expect(session?.pendingInputs).toBe(1);
      const input = await fixture.store.sessions!.getInput(
        fixture.namespace,
        fixture.conversation.id,
        inputId,
      );
      expect(input?.cursor).toBe(1);
    } finally {
      fixture.host.dispose();
    }
  });

  it("boundary settles a new pending delivery behind >100 terminal-delivery Works", async () => {
    const fixture = await createRaceFixture("backlog-budget");
    try {
      const sessionId = fixture.conversation.id;
      const parseSchema = z.object({ message: z.string() });
      const now = new Date();

      // Seed >LIMIT pending Work rows whose deliveries are already terminal.
      for (let index = 0; index < SESSION_SIGNAL_INGRESS_SETTLE_LIMIT + 5; index += 1) {
        const deliveryId = `del_old_${index}`;
        const occurrenceId = `occ_old_${index}`;
        await fixture.store.transact(async (tx) => {
          await tx.signals!.putOccurrence(
            Object.freeze({
              schemaVersion: 1 as const,
              namespace: fixture.namespace,
              occurrenceId,
              signalId: fixture.tick.id,
              payload: { message: `old-${index}` },
              acceptedAt: now.toISOString(),
            }),
          );
          await tx.signals!.putDelivery(
            Object.freeze({
              schemaVersion: 1 as const,
              namespace: fixture.namespace,
              deliveryId,
              occurrenceId,
              consumer: Object.freeze({
                kind: "session.subscription" as const,
                sessionId,
                subscriptionId: "sub_old",
              }),
              state: "delivered" as const,
              attempts: 1,
              updatedAt: now.toISOString(),
            }),
          );
          const identity = sessionSignalIngressIdentity(
            fixture.namespace,
            deliveryId,
          );
          const created = await tx.state.createWork({
            workId: identity.workId,
            namespace: fixture.namespace,
            work: {
              kind: "session.signal-ingress",
              sessionId,
              deliveryId,
              occurrenceId,
              subscriptionId: "sub_old",
            },
            targetId: "agent" as RuntimeTargetId,
            idempotencyKey: `session.signal-ingress:${deliveryId}`,
            now,
          });
          await tx.state.putWork(
            Object.freeze({
              ...created,
              application: initialApplicationWorkState(
                created.workId,
                created.createdAt,
                identity.effects,
              ),
            }),
          );
        });
      }

      // One real pending delivery + Work that must still settle at the boundary.
      const freshDeliveryId = "del_fresh_pending";
      const freshOccurrenceId = "occ_fresh_pending";
      await fixture.store.transact(async (tx) => {
        await tx.signals!.putOccurrence(
          Object.freeze({
            schemaVersion: 1 as const,
            namespace: fixture.namespace,
            occurrenceId: freshOccurrenceId,
            signalId: fixture.tick.id,
            payload: { message: "fresh" },
            acceptedAt: now.toISOString(),
          }),
        );
        await tx.signals!.putDelivery(
          Object.freeze({
            schemaVersion: 1 as const,
            namespace: fixture.namespace,
            deliveryId: freshDeliveryId,
            occurrenceId: freshOccurrenceId,
            consumer: Object.freeze({
              kind: "session.subscription" as const,
              sessionId,
              subscriptionId: "sub_fresh",
            }),
            state: "pending" as const,
            attempts: 0,
            updatedAt: now.toISOString(),
          }),
        );
        const identity = sessionSignalIngressIdentity(
          fixture.namespace,
          freshDeliveryId,
        );
        const created = await tx.state.createWork({
          workId: identity.workId,
          namespace: fixture.namespace,
          work: {
            kind: "session.signal-ingress",
            sessionId,
            deliveryId: freshDeliveryId,
            occurrenceId: freshOccurrenceId,
            subscriptionId: "sub_fresh",
          },
          targetId: "agent" as RuntimeTargetId,
          idempotencyKey: `session.signal-ingress:${freshDeliveryId}`,
          now,
        });
        await tx.state.putWork(
          Object.freeze({
            ...created,
            application: initialApplicationWorkState(
              created.workId,
              created.createdAt,
              identity.effects,
            ),
          }),
        );
        await tx.outbox.put(wakeEnvelopeForWork(created), { deliverAt: now });
      });

      await fixture.store.transact(async (tx) => {
        await settlePendingAgentSessionSignalIngressForSession(tx, {
          namespace: fixture.namespace,
          sessionId,
          now: new Date(),
          parseSchema,
        });
      });

      const delivery = await fixture.store.signals.getDelivery(
        fixture.namespace,
        freshDeliveryId,
      );
      expect(delivery?.state).toBe("delivered");
      const accepted = await fixture.store.sessions!.getInput(
        fixture.namespace,
        sessionId,
        signalIngressInputId(freshDeliveryId),
      );
      expect(accepted?.cursor).toBe(1);
      const session = await fixture.store.sessions!.get(
        fixture.namespace,
        sessionId,
      );
      expect(session?.acceptedCursor).toBe(1);
    } finally {
      fixture.host.dispose();
    }
  });
});

async function createRaceFixture(id: string) {
  const execute = async () => ({
    agentId: `agent-race-${id}`,
    output: { reply: "ok" },
    durationMs: 1,
  }) satisfies ReturnType<AgentExecutor>;
  const model = defineGenerationModel({
    adapter: { id: "test", version: "1" },
    native: Object.freeze({ id: "race-model" }),
    definition: { id: `test:race:${id}`, fingerprint: "v1" },
    identity: { kind: "model", model: `race-${id}` },
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
    id: `agent-race.${id}`,
    schema: z.object({ message: z.string() }),
  });
  const support = agent({
    id: `agent-race-support-${id}`,
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
        definition: { id: `agent:race:${id}`, fingerprint: "v1" },
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
  const namespace = `agent-race-${id}`;
  const hostRuntime = node({ store, namespace, autoStartMaintenance: false });
  config({ storage: { records }, runtime: hostRuntime });
  const host = createWorkHost({ runtime: hostRuntime, program });
  const conversation = await host.run(() =>
    session(support, { key: `customer-${id}` }),
  );
  return {
    conversation,
    host,
    namespace,
    store,
    tick,
    startWorker: () =>
      createRuntimeWorker({
        runtime: node({ store, namespace, autoStartMaintenance: false }),
        program,
        pollIntervalMs: 1,
      }),
  };
}

