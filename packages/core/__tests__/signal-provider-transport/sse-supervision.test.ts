/**
 * SSE adapter boundary through the existing managed stream fiber.
 *
 * Proves lowering reaches durable accept/checkpoint without a second
 * supervisor. Reuses Memory worker supervision paths from stream tests.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { signal } from "../../src/signal";
import {
  sse,
  type SseItem,
  type SseOpenContext,
} from "../../src/signal/transport";
import {
  managedTransportBinding,
  signalProvider,
} from "../../src/signal/provider";
import {
  createRuntimeProgram,
  createRuntimeWorker,
  createWorkerTransportSupervision,
  inMemoryRuntimeStore,
  ManagedStreamTerminalError,
  node,
  type RuntimeAcceptedTransportPayload,
  type RuntimeTransportConfigRef,
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

function sseEnvelopeItem(options: {
  readonly eventId: string;
  readonly lastEventId?: string | null;
  readonly accountId?: string;
}): SseItem {
  const item: SseItem = {
    kind: "envelope",
    accountId: options.accountId ?? "acct_1",
    eventId: options.eventId,
    authenticatedRouting: { source: "sse" },
    payload: inlinePayload(
      JSON.stringify({ orderId: options.eventId.replace("evt_", "ord_") }),
    ),
  };

  if (options.lastEventId !== undefined) {
    return Object.freeze({ ...item, lastEventId: options.lastEventId });
  }

  return Object.freeze(item);
}

function sseCursorItem(lastEventId: string | null): SseItem {
  return Object.freeze({ kind: "cursor" as const, lastEventId });
}

type SseOpenCall = {
  readonly cursor: string | null;
  readonly configRef: RuntimeTransportConfigRef;
  readonly signal: AbortSignal;
};

function createSseFixture(options?: {
  readonly configRef?: RuntimeTransportConfigRef;
  readonly bindingId?: string;
  readonly providerId?: string;
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

  const openCalls: SseOpenCall[] = [];
  let itemFactory:
    | ((
        context: SseOpenCall,
      ) => AsyncIterable<SseItem> | Promise<AsyncIterable<SseItem>>)
    | null = null;

  const configRef = options?.configRef ?? {
    id: "config.orders.sse",
    revision: "rev.1",
  };
  const providerId = options?.providerId ?? "orders.sse";
  const bindingId = options?.bindingId ?? "binding.orders.sse";

  const provider = signalProvider({
    id: providerId,
    transport: sse({
      async open(context: SseOpenContext) {
        const call: SseOpenCall = {
          cursor: context.cursor,
          configRef: context.configRef,
          signal: context.signal,
        };
        openCalls.push(call);
        if (!itemFactory) {
          return emptySseIterable();
        }
        return itemFactory(call);
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
    id: bindingId,
    configRef,
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
    provider,
    published,
    openCalls,
    setItems(
      factory: (
        context: SseOpenCall,
      ) => AsyncIterable<SseItem> | Promise<AsyncIterable<SseItem>>,
    ): void {
      itemFactory = factory;
    },
    setItemSequence(items: readonly SseItem[]): void {
      itemFactory = async function* () {
        for (const item of items) {
          yield item;
        }
      };
    },
  };
}

async function* emptySseIterable(): AsyncGenerator<SseItem, void, unknown> {
  // Clean EOF with no items.
}

describe("SSE supervision via managed stream fiber", () => {
  it("accepts one envelope with lastEventId and checkpoints that cursor", async () => {
    const fixture = createSseFixture();
    fixture.setItemSequence([
      sseEnvelopeItem({ eventId: "evt_1", lastEventId: "sse-id:1" }),
    ]);

    const store = inMemoryRuntimeStore();
    const namespace = "sse-accept-cursor";
    const worker = createRuntimeWorker({
      runtime: node({
        store,
        namespace,
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

      const envelope = await store.transports!.get({
        namespace,
        provider: "orders.sse",
        accountId: "acct_1",
        eventId: "evt_1",
      });
      expect(envelope?.state).toBe("normalized");

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      expect(checkpoint).toMatchObject({
        cursor: "sse-id:1",
        configRef: fixture.binding.configRef,
        status: "active",
      });

      expect(fixture.openCalls.length).toBeGreaterThanOrEqual(1);
      expect(fixture.openCalls[0]?.cursor).toBeNull();
      expect(fixture.provider.transport._tag).toBe("SseTransport");
      expect(fixture.provider.transport.kind).toBe("sse");
    } finally {
      await worker.stop();
    }
  });

  it("advances checkpoint from a cursor-only SSE item without a new envelope", async () => {
    const fixture = createSseFixture();
    fixture.setItemSequence([sseCursorItem("sse-id:hb-9")]);

    const store = inMemoryRuntimeStore();
    const namespace = "sse-cursor-only";
    const supervision = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-a",
    });
    expect(supervision).toBeDefined();

    try {
      await supervision!.runOnce(
        new AbortController().signal,
        new Date("2026-08-08T12:00:00.000Z"),
      );

      await expect
        .poll(async () => {
          const checkpoint = await store.transports!.getBindingCheckpoint!({
            namespace,
            bindingId: fixture.binding.id,
          });
          return checkpoint?.cursor;
        }, { timeout: 5_000 })
        .toBe("sse-id:hb-9");

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      expect(checkpoint).toMatchObject({
        cursor: "sse-id:hb-9",
        configRef: fixture.binding.configRef,
        status: "active",
      });

      await expect(
        store.transports!.get({
          namespace,
          provider: "orders.sse",
          accountId: "acct_1",
          eventId: "evt_1",
        }),
      ).resolves.toBeNull();
    } finally {
      await supervision!.dispose();
    }
  });

  it("writes durable faulted status on ManagedStreamTerminalError without reopening", async () => {
    const fixture = createSseFixture();
    let opens = 0;
    fixture.setItems(async function* () {
      opens += 1;
      throw new ManagedStreamTerminalError("SSE_HTTP_401", "credentials revoked");
    });

    const store = inMemoryRuntimeStore();
    const namespace = "sse-terminal-fault";
    const supervision = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-a",
    })!;

    try {
      await supervision.runOnce(
        new AbortController().signal,
        new Date("2026-08-08T12:00:00.000Z"),
      );

      await expect
        .poll(async () => {
          const checkpoint = await store.transports!.getBindingCheckpoint!({
            namespace,
            bindingId: fixture.binding.id,
          });
          return checkpoint?.status;
        }, { timeout: 5_000 })
        .toBe("faulted");

      const opensAfterFault = opens;

      // Further ticks must not reopen under durable faulted + same config.
      await supervision.runOnce(
        new AbortController().signal,
        new Date("2026-08-08T12:00:01.000Z"),
      );
      await supervision.runOnce(
        new AbortController().signal,
        new Date("2026-08-08T12:00:02.000Z"),
      );

      expect(opens).toBe(opensAfterFault);
      expect(opens).toBe(1);

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      expect(checkpoint).toMatchObject({
        status: "faulted",
        lastErrorCode: "SSE_HTTP_401",
        configRef: fixture.binding.configRef,
      });
    } finally {
      await supervision.dispose();
    }
  });

  it("does not invent a second supervisor for clean EOF of a finite iterable", async () => {
    const fixture = createSseFixture();
    fixture.setItemSequence([
      sseEnvelopeItem({ eventId: "evt_1", lastEventId: "sse-id:1" }),
    ]);

    const store = inMemoryRuntimeStore();
    const namespace = "sse-single-supervisor";
    const signal = new AbortController().signal;

    const first = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-a",
    })!;
    const second = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-b",
    })!;

    try {
      const [left, right] = await Promise.all([
        first.runOnce(signal, new Date("2026-08-08T12:00:00.000Z")),
        second.runOnce(signal, new Date("2026-08-08T12:00:00.000Z")),
      ]);

      // One lease-winning supervisor owns the binding; the other skips.
      const opened =
        (left.streamOpened ?? 0) + (right.streamOpened ?? 0);
      expect(opened).toBe(1);
      expect(fixture.openCalls.length).toBeGreaterThanOrEqual(1);

      const winners = [left, right].filter(
        (result) => (result.streamOpened ?? 0) > 0 || result.leased > 0,
      );
      const losers = [left, right].filter((result) => result.skipped > 0);
      expect(winners.length).toBeGreaterThanOrEqual(1);
      expect(losers.length).toBeGreaterThanOrEqual(1);

      await expect
        .poll(async () => {
          const envelope = await store.transports!.get({
            namespace,
            provider: "orders.sse",
            accountId: "acct_1",
            eventId: "evt_1",
          });
          return envelope?.state;
        }, { timeout: 5_000 })
        .toBe("accepted");

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      expect(checkpoint?.cursor).toBe("sse-id:1");
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });
});
