/**
 * WebSocket adapter boundary through the existing managed stream fiber.
 *
 * Proves lowering reaches durable accept/checkpoint and optional post-accept
 * ack without a second supervisor. Uses Memory worker supervision paths.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { signal } from "../../src/signal";
import {
  websocket,
  type WebSocketItem,
  type WebSocketOpenContext,
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
  TRANSPORT_ACK_FAILED,
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

function wsEnvelopeItem(options: {
  readonly eventId: string;
  readonly cursor?: string | null;
  readonly accountId?: string;
  readonly acknowledge?: () => void | Promise<void>;
}): WebSocketItem {
  const item: WebSocketItem = {
    kind: "envelope",
    accountId: options.accountId ?? "acct_1",
    eventId: options.eventId,
    authenticatedRouting: { source: "websocket" },
    payload: inlinePayload(
      JSON.stringify({ orderId: options.eventId.replace("evt_", "ord_") }),
    ),
  };

  return Object.freeze({
    ...item,
    ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
    ...(options.acknowledge !== undefined
      ? { acknowledge: options.acknowledge }
      : {}),
  });
}

type WsOpenCall = {
  readonly cursor: string | null;
  readonly configRef: RuntimeTransportConfigRef;
  readonly signal: AbortSignal;
};

function createWsFixture(options?: {
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

  const openCalls: WsOpenCall[] = [];
  let itemFactory:
    | ((
        context: WsOpenCall,
      ) => AsyncIterable<WebSocketItem> | Promise<AsyncIterable<WebSocketItem>>)
    | null = null;

  const configRef = options?.configRef ?? {
    id: "config.orders.ws",
    revision: "rev.1",
  };
  const providerId = options?.providerId ?? "orders.ws";
  const bindingId = options?.bindingId ?? "binding.orders.ws";

  const provider = signalProvider({
    id: providerId,
    transport: websocket({
      async open(context: WebSocketOpenContext) {
        const call: WsOpenCall = {
          cursor: context.cursor,
          configRef: context.configRef,
          signal: context.signal,
        };
        openCalls.push(call);
        if (!itemFactory) {
          return emptyWsIterable();
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
        context: WsOpenCall,
      ) => AsyncIterable<WebSocketItem> | Promise<AsyncIterable<WebSocketItem>>,
    ): void {
      itemFactory = factory;
    },
    setItemSequence(items: readonly WebSocketItem[]): void {
      itemFactory = async function* () {
        for (const item of items) {
          yield item;
        }
      };
    },
  };
}

async function* emptyWsIterable(): AsyncGenerator<WebSocketItem, void, unknown> {
  // Clean EOF with no items.
}

describe("WebSocket supervision via managed stream fiber", () => {
  it("accepts one envelope with cursor and checkpoints that cursor", async () => {
    const fixture = createWsFixture();
    fixture.setItemSequence([
      wsEnvelopeItem({ eventId: "evt_1", cursor: "ws-cursor:1" }),
    ]);

    const store = inMemoryRuntimeStore();
    const namespace = "ws-accept-cursor";
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
        provider: "orders.ws",
        accountId: "acct_1",
        eventId: "evt_1",
      });
      expect(envelope?.state).toBe("normalized");

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      expect(checkpoint).toMatchObject({
        cursor: "ws-cursor:1",
        configRef: fixture.binding.configRef,
        status: "active",
      });

      expect(fixture.openCalls.length).toBeGreaterThanOrEqual(1);
      expect(fixture.openCalls[0]?.cursor).toBeNull();
      expect(fixture.provider.transport._tag).toBe("WebSocketTransport");
      expect(fixture.provider.transport.kind).toBe("websocket");
    } finally {
      await worker.stop();
    }
  });

  it("invokes acknowledge only after durable accept and cursor checkpoint", async () => {
    const fixture = createWsFixture();
    const store = inMemoryRuntimeStore();
    const namespace = "ws-post-accept-ack";
    let ackSawAccepted = false;
    let ackSawCursor = false;
    let ackCalls = 0;

    fixture.setItems(async function* () {
      yield wsEnvelopeItem({
        eventId: "evt_ack",
        cursor: "ws-cursor:ack",
        acknowledge: async () => {
          ackCalls += 1;
          // Durable accept + cursor checkpoint must already be visible.
          const envelope = await store.transports!.get({
            namespace,
            provider: "orders.ws",
            accountId: "acct_1",
            eventId: "evt_ack",
          });
          ackSawAccepted = envelope?.state === "accepted";
          const checkpoint = await store.transports!.getBindingCheckpoint!({
            namespace,
            bindingId: fixture.binding.id,
          });
          ackSawCursor = checkpoint?.cursor === "ws-cursor:ack";
        },
      });
    });

    const supervision = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-ack",
    });

    try {
      await supervision!.runOnce(
        new AbortController().signal,
        new Date("2026-08-08T12:00:00.000Z"),
      );

      await expect.poll(() => ackCalls, { timeout: 5_000 }).toBe(1);
      expect(ackSawAccepted).toBe(true);
      expect(ackSawCursor).toBe(true);

      const envelope = await store.transports!.get({
        namespace,
        provider: "orders.ws",
        accountId: "acct_1",
        eventId: "evt_ack",
      });
      expect(envelope?.state).toBe("accepted");

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      expect(checkpoint?.cursor).toBe("ws-cursor:ack");
      expect(checkpoint?.status).toBe("active");
    } finally {
      await supervision!.dispose();
    }
  });

  it("keeps acceptance and cursor when acknowledge fails", async () => {
    const fixture = createWsFixture();
    fixture.setItemSequence([
      wsEnvelopeItem({
        eventId: "evt_fail_ack",
        cursor: "ws-cursor:fail",
        acknowledge: async () => {
          throw Object.assign(new Error("provider ack rejected"), {
            code: "PROVIDER_ACK_REJECTED",
          });
        },
      }),
    ]);

    const store = inMemoryRuntimeStore();
    const namespace = "ws-ack-failure";
    const supervision = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
      ownerId: "worker-ack-fail",
    });

    try {
      await supervision!.runOnce(
        new AbortController().signal,
        new Date("2026-08-08T12:00:00.000Z"),
      );

      await expect
        .poll(async () => {
          const envelope = await store.transports!.get({
            namespace,
            provider: "orders.ws",
            accountId: "acct_1",
            eventId: "evt_fail_ack",
          });
          return envelope?.state;
        }, { timeout: 5_000 })
        .toBe("accepted");

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      // Cursor retained — ack failure must not lose replay safety.
      expect(checkpoint?.cursor).toBe("ws-cursor:fail");
      expect(checkpoint?.status).toBe("active");
      expect(checkpoint?.lastErrorCode).toBe("PROVIDER_ACK_REJECTED");
    } finally {
      await supervision!.dispose();
    }
  });

  it("records TRANSPORT_ACK_FAILED when ack error has no safe code", async () => {
    const fixture = createWsFixture({ bindingId: "binding.ws.ack-default" });
    fixture.setItemSequence([
      wsEnvelopeItem({
        eventId: "evt_ack_default",
        cursor: "ws-cursor:default",
        acknowledge: async () => {
          throw new Error("opaque provider failure");
        },
      }),
    ]);

    const store = inMemoryRuntimeStore();
    const namespace = "ws-ack-default-code";
    const supervision = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
    });

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
          return checkpoint?.lastErrorCode;
        }, { timeout: 5_000 })
        .toBe(TRANSPORT_ACK_FAILED);

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      expect(checkpoint?.cursor).toBe("ws-cursor:default");
      expect(checkpoint?.status).toBe("active");
    } finally {
      await supervision!.dispose();
    }
  });

  it("durable-faults on ManagedStreamTerminalError without reopening", async () => {
    const fixture = createWsFixture({ bindingId: "binding.ws.terminal" });
    let opens = 0;
    fixture.setItems(async function* () {
      opens += 1;
      throw new ManagedStreamTerminalError("AUTH_REVOKED", "credentials revoked");
    });

    const store = inMemoryRuntimeStore();
    const namespace = "ws-terminal";
    const supervision = createWorkerTransportSupervision({
      program: fixture.program,
      store,
      namespace,
    });

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
          return checkpoint?.status;
        }, { timeout: 5_000 })
        .toBe("faulted");

      const checkpoint = await store.transports!.getBindingCheckpoint!({
        namespace,
        bindingId: fixture.binding.id,
      });
      expect(checkpoint?.lastErrorCode).toBe("AUTH_REVOKED");
      expect(opens).toBe(1);

      // Second pass must not reopen while faulted under the same config identity.
      await supervision!.runOnce(
        new AbortController().signal,
        new Date("2026-08-08T12:00:01.000Z"),
      );
      expect(opens).toBe(1);
    } finally {
      await supervision!.dispose();
    }
  });
});
