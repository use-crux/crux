/**
 * Managed polling supervision on the single Runtime worker.
 *
 * Vertical: inert binding + polling provider → worker lease → poll → durable
 * accept → checkpoint → restart resumes cursor without duplicate logical
 * occurrence → stop aborts acquisition.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { signal } from "../../src/signal";
import { polling } from "../../src/signal/transport";
import {
  managedTransportBinding,
  signalProvider,
} from "../../src/signal/provider";
import {
  bindingLeaseResource,
  createRuntimeProgram,
  createRuntimeWorker,
  createTransportNormalizationRunner,
  createWorkerTransportSupervision,
  inMemoryRuntimeStore,
  node,
  type RuntimeAcceptedTransportPayload,
} from "../../src/runtime/public";

function inlinePayload(text: string): RuntimeAcceptedTransportPayload {
  const bytes = new TextEncoder().encode(text);
  return {
    kind: "inline-base64url",
    value: Buffer.from(bytes).toString("base64url"),
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function createPollingFixture(options?: {
  readonly failPollOnce?: boolean;
}) {
  const orderSubmitted = signal({
    id: "order.submitted",
    schema: z.object({ orderId: z.string() }),
  });
  const published: Array<{ orderId: string; occurrenceId: string }> = [];
  orderSubmitted.subscribe((occurrence) => {
    published.push({
      orderId: occurrence.payload.orderId,
      occurrenceId: occurrence.id,
    });
  });

  const pollCalls: Array<{ cursor: string | null }> = [];
  let pages = new Map<string | null, { events: string[]; next: string | null }>([
    [null, { events: ["evt_1"], next: "cursor:1" }],
    ["cursor:1", { events: ["evt_2"], next: "cursor:2" }],
    ["cursor:2", { events: [], next: "cursor:2" }],
  ]);
  let failOnce = options?.failPollOnce === true;

  const provider = signalProvider({
    id: "orders.poll",
    transport: polling({
      async poll({ cursor, signal }) {
        if (signal.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        pollCalls.push({ cursor });
        if (failOnce) {
          failOnce = false;
          throw Object.assign(new Error("provider unavailable"), {
            code: "PROVIDER_UNAVAILABLE",
          });
        }
        const page = pages.get(cursor) ?? { events: [], next: cursor };
        return {
          events: page.events.map((eventId) => ({
            accountId: "acct_1",
            eventId,
            authenticatedRouting: { source: "polling" },
            payload: inlinePayload(
              JSON.stringify({ orderId: eventId.replace("evt_", "ord_") }),
            ),
          })),
          nextCursor: page.next,
        };
      },
    }),
    signals: { orderSubmitted },
    async onEvent(envelope, { signals }) {
      const raw =
        envelope.payload.kind === "inline-base64url"
          ? Buffer.from(envelope.payload.value, "base64url").toString("utf8")
          : "";
      const body = JSON.parse(raw) as { orderId: string };
      await signals.orderSubmitted.publish({ orderId: body.orderId });
    },
  });

  const binding = managedTransportBinding(provider, {
    id: "binding.orders.poll",
    configRef: { id: "config.orders.poll", revision: "rev.1" },
    signalId: "order.submitted",
  });
  const program = createRuntimeProgram({
    targets: [],
    providers: [provider],
    transports: [binding],
  });

  return {
    binding,
    program,
    published,
    pollCalls,
    setPages(
      next: Map<string | null, { events: string[]; next: string | null }>,
    ) {
      pages = next;
    },
  };
}

describe("Runtime worker polling supervision", () => {
  it("polls, durably accepts, checkpoints, and normalizes through the worker", async () => {
    const { binding, program, published, pollCalls } = createPollingFixture();
    const store = inMemoryRuntimeStore();
    const worker = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "poll-supervise",
        autoStartMaintenance: false,
      }),
      program,
      pollIntervalMs: 5,
    });

    try {
      await expect
        .poll(() => published.map((entry) => entry.orderId), {
          timeout: 5_000,
        })
        .toEqual(["ord_1", "ord_2"]);

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-supervise",
        bindingId: binding.id,
      });
      expect(checkpoint?.cursor).toBe("cursor:2");
      expect(pollCalls[0]?.cursor).toBeNull();
      expect(pollCalls.some((call) => call.cursor === "cursor:1")).toBe(true);

      const envelope = await store.transports!.get({
        namespace: "poll-supervise",
        provider: "orders.poll",
        accountId: "acct_1",
        eventId: "evt_1",
      });
      expect(envelope?.state).toBe("normalized");
    } finally {
      await worker.stop();
    }
  });

  it("resumes the durable cursor after restart without redelivering", async () => {
    const fixture = createPollingFixture();
    // Only the first page is available before restart.
    fixture.setPages(
      new Map([
        [null, { events: ["evt_1"], next: "cursor:1" }],
        ["cursor:1", { events: [], next: "cursor:1" }],
      ]),
    );
    const store = inMemoryRuntimeStore();
    const first = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "poll-restart",
        autoStartMaintenance: false,
      }),
      program: fixture.program,
      pollIntervalMs: 5,
    });

    try {
      await expect
        .poll(() => fixture.published.map((entry) => entry.orderId), {
          timeout: 5_000,
        })
        .toEqual(["ord_1"]);
      await expect
        .poll(async () => {
          const checkpoint = await store.transports!.getBindingCheckpoint!({
            namespace: "poll-restart",
            bindingId: fixture.binding.id,
          });
          return checkpoint?.cursor;
        }, { timeout: 5_000 })
        .toBe("cursor:1");
    } finally {
      await first.stop();
    }

    const occurrenceId = fixture.published[0]!.occurrenceId;
    const beforeRestart = fixture.pollCalls.length;
    fixture.setPages(
      new Map([
        ["cursor:1", { events: ["evt_2"], next: "cursor:2" }],
        ["cursor:2", { events: [], next: "cursor:2" }],
      ]),
    );

    const second = createRuntimeWorker({
      runtime: node({
        store,
        namespace: "poll-restart",
        autoStartMaintenance: false,
      }),
      program: fixture.program,
      pollIntervalMs: 5,
    });

    try {
      await expect
        .poll(() => fixture.published.map((entry) => entry.orderId), {
          timeout: 5_000,
        })
        .toEqual(["ord_1", "ord_2"]);
      expect(fixture.published[0]!.occurrenceId).toBe(occurrenceId);
      expect(
        fixture.pollCalls
          .slice(beforeRestart)
          .some((call) => call.cursor === "cursor:1"),
      ).toBe(true);
      expect(
        fixture.pollCalls
          .slice(beforeRestart)
          .every((call) => call.cursor !== null),
      ).toBe(true);
    } finally {
      await second.stop();
    }
  });

  it("coordinates competing supervisors through binding leases", async () => {
    const { binding, program, published } = createPollingFixture();
    const store = inMemoryRuntimeStore();
    const signal = new AbortController().signal;

    const first = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-lease",
      ownerId: "worker-a",
    })!;
    const second = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-lease",
      ownerId: "worker-b",
    })!;

    try {
      const [left, right] = await Promise.all([
        first.runOnce(signal, new Date("2026-08-07T12:00:00.000Z")),
        second.runOnce(signal, new Date("2026-08-07T12:00:00.000Z")),
      ]);

      const winners = [left, right].filter((result) => result.polled > 0);
      const losers = [left, right].filter((result) => result.skipped > 0);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(winners[0]!.accepted).toBe(1);

      const drain = createTransportNormalizationRunner({
        store,
        namespace: "poll-lease",
        providers: program.providers,
      });
      await drain.runOnce({ now: new Date("2026-08-07T12:00:01.000Z") });
      expect(published.map((entry) => entry.orderId)).toEqual(["ord_1"]);

      const lease = await store.leases.claim(
        bindingLeaseResource("poll-lease", binding.id),
        { ttlMs: 1_000, ownerId: "intruder" },
      );
      expect(lease).toBeNull();
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it("honors PollResult.more by skipping intervalMs on the next tick", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const pollCalls: Array<{ cursor: string | null }> = [];
    const provider = signalProvider({
      id: "orders.poll.more",
      transport: polling({
        intervalMs: 60_000,
        async poll({ cursor }) {
          pollCalls.push({ cursor });
          if (cursor === null) {
            return {
              events: [
                {
                  accountId: "acct_1",
                  eventId: "evt_more_1",
                  authenticatedRouting: { source: "polling" },
                  payload: inlinePayload(JSON.stringify({ orderId: "ord_1" })),
                },
              ],
              nextCursor: "cursor:1",
              more: true,
            };
          }
          return {
            events: [],
            nextCursor: cursor,
            more: false,
          };
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {
        // Acceptance-only probe; normalization is not required for morePending.
      },
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.more",
      configRef: { id: "config.orders.poll.more", revision: "rev.1" },
      signalId: "order.submitted",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
    });
    const store = inMemoryRuntimeStore();
    const runner = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-more",
      ownerId: "worker-a",
    })!;
    const signalAbort = new AbortController().signal;

    try {
      const first = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(first.accepted).toBe(1);
      expect(first.checkpointed).toBe(1);

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-more",
        bindingId: binding.id,
      });
      expect(checkpoint?.cursor).toBe("cursor:1");
      expect(checkpoint?.morePending).toBe(true);

      const second = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:01.000Z"),
      );
      expect(second.polled).toBe(1);
      expect(pollCalls).toHaveLength(2);

      const cleared = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-more",
        bindingId: binding.id,
      });
      expect(cleared?.morePending).toBeUndefined();
    } finally {
      await runner.dispose();
    }
  });

  it("does not advance the cursor when a poll fails", async () => {
    const { binding, program, pollCalls } = createPollingFixture({
      failPollOnce: true,
    });
    const store = inMemoryRuntimeStore();
    const runner = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-fail",
      ownerId: "worker-a",
    })!;
    const signal = new AbortController().signal;

    try {
      const failed = await runner.runOnce(
        signal,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(failed.failed).toBe(1);
      expect(failed.checkpointed).toBe(0);
      expect(pollCalls).toHaveLength(1);

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-fail",
        bindingId: binding.id,
      });
      expect(checkpoint?.cursor).toBeNull();
      expect(checkpoint?.lastErrorCode).toBe("PROVIDER_UNAVAILABLE");

      const recovered = await runner.runOnce(
        signal,
        new Date("2026-08-07T12:00:01.000Z"),
      );
      expect(recovered.accepted).toBe(1);
      expect(recovered.checkpointed).toBe(1);

      const advanced = await store.transports!.getBindingCheckpoint!({
        namespace: "poll-fail",
        bindingId: binding.id,
      });
      expect(advanced?.cursor).toBe("cursor:1");
      expect(advanced?.lastErrorCode).toBeUndefined();
    } finally {
      await runner.dispose();
    }
  });

  it("dedupes stable provider event IDs on redelivery through the envelope kernel", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    const published: string[] = [];
    orderSubmitted.subscribe((occurrence) => {
      published.push(occurrence.id);
    });
    const provider = signalProvider({
      id: "orders.poll.dedupe",
      transport: polling({
        async poll() {
          return {
            events: [
              {
                accountId: "acct_1",
                eventId: "evt_same",
                authenticatedRouting: { source: "polling" },
                payload: inlinePayload(JSON.stringify({ orderId: "ord_same" })),
              },
            ],
            // Stay at the initial cursor so the next tick redelivers the same id.
            nextCursor: null,
          };
        },
      }),
      signals: { orderSubmitted },
      async onEvent(envelope, { signals }) {
        const raw =
          envelope.payload.kind === "inline-base64url"
            ? Buffer.from(envelope.payload.value, "base64url").toString("utf8")
            : "";
        const body = JSON.parse(raw) as { orderId: string };
        await signals.orderSubmitted.publish({ orderId: body.orderId });
      },
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.dedupe",
      configRef: { id: "config.orders.poll.dedupe", revision: "rev.1" },
      signalId: "order.submitted",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
    });
    const store = inMemoryRuntimeStore();
    const runner = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-dedupe",
      ownerId: "worker-a",
    })!;
    const drain = createTransportNormalizationRunner({
      store,
      namespace: "poll-dedupe",
      providers: program.providers,
    });
    const signalAbort = new AbortController().signal;

    try {
      const first = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:00.000Z"),
      );
      expect(first.accepted).toBe(1);
      expect(first.duplicated).toBe(0);
      await drain.runOnce({ now: new Date("2026-08-07T12:00:00.500Z") });
      expect(published).toHaveLength(1);

      const second = await runner.runOnce(
        signalAbort,
        new Date("2026-08-07T12:00:01.000Z"),
      );
      expect(second.accepted).toBe(0);
      expect(second.duplicated).toBe(1);
      await drain.runOnce({ now: new Date("2026-08-07T12:00:01.500Z") });
      expect(published).toHaveLength(1);
    } finally {
      await runner.dispose();
    }
  });

  it("aborts in-flight poll acquisition and releases the binding lease on dispose", async () => {
    const orderSubmitted = signal({
      id: "order.submitted",
      schema: z.object({ orderId: z.string() }),
    });
    let pollEntered: (() => void) | undefined;
    const pollStarted = new Promise<void>((resolve) => {
      pollEntered = resolve;
    });
    let sawAbort = false;
    const provider = signalProvider({
      id: "orders.poll.abort",
      transport: polling({
        async poll({ signal }) {
          pollEntered?.();
          await new Promise<void>((resolve, reject) => {
            if (signal.aborted) {
              reject(new DOMException("aborted", "AbortError"));
              return;
            }
            signal.addEventListener(
              "abort",
              () => {
                sawAbort = true;
                reject(new DOMException("aborted", "AbortError"));
              },
              { once: true },
            );
          });
          return { events: [], nextCursor: null };
        },
      }),
      signals: { orderSubmitted },
      async onEvent() {},
    });
    const binding = managedTransportBinding(provider, {
      id: "binding.orders.poll.abort",
      configRef: { id: "config.orders.poll.abort", revision: "rev.1" },
      signalId: "order.submitted",
    });
    const program = createRuntimeProgram({
      targets: [],
      providers: [provider],
      transports: [binding],
    });
    const store = inMemoryRuntimeStore();
    const runner = createWorkerTransportSupervision({
      program,
      store,
      namespace: "poll-abort",
      ownerId: "worker-a",
    })!;
    const controller = new AbortController();

    const runPromise = runner.runOnce(
      controller.signal,
      new Date("2026-08-07T12:00:00.000Z"),
    );
    await pollStarted;
    controller.abort();
    const outcome = await runPromise;
    expect(sawAbort).toBe(true);
    expect(outcome.checkpointed).toBe(0);
    expect(outcome.accepted).toBe(0);

    await runner.dispose();

    const reclaim = await store.leases.claim(
      bindingLeaseResource("poll-abort", binding.id),
      { ttlMs: 1_000, ownerId: "replacement" },
    );
    expect(reclaim).not.toBeNull();
    await store.leases.release(reclaim!);
  });
});
