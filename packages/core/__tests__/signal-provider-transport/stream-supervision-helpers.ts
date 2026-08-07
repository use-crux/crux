/**
 * Shared fixtures for managed stream supervision tests.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

import { signal } from "../../src/signal";
import { stream, type StreamItem } from "../../src/signal/transport";
import {
  managedTransportBinding,
  signalProvider,
} from "../../src/signal/provider";
import {
  createRuntimeProgram,
  type RuntimeAcceptedTransportPayload,
  type RuntimeTransportBindingCheckpoint,
  type RuntimeTransportConfigRef,
} from "../../src/runtime/public";

export function inlinePayload(text: string): RuntimeAcceptedTransportPayload {
  const bytes = new TextEncoder().encode(text);
  return {
    kind: "inline-base64url",
    value: Buffer.from(bytes).toString("base64url"),
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function envelopeItem(options: {
  readonly eventId: string;
  readonly cursor?: string | null;
  readonly accountId?: string;
}): StreamItem {
  const item: StreamItem = {
    kind: "envelope",
    accountId: options.accountId ?? "acct_1",
    eventId: options.eventId,
    authenticatedRouting: { source: "stream" },
    payload: inlinePayload(
      JSON.stringify({ orderId: options.eventId.replace("evt_", "ord_") }),
    ),
  };

  if (options.cursor !== undefined) {
    return Object.freeze({ ...item, cursor: options.cursor });
  }

  return Object.freeze(item);
}

export function cursorItem(cursor: string | null): StreamItem {
  return Object.freeze({ kind: "cursor" as const, cursor });
}

export type StreamOpenCall = {
  readonly cursor: string | null;
  readonly configRef: RuntimeTransportConfigRef;
  readonly signal: AbortSignal;
};

/**
 * Build a stream provider fixture with a controllable fake open iterable.
 */
export function createStreamFixture(options?: {
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

  const openCalls: StreamOpenCall[] = [];
  let itemFactory:
    | ((
        context: StreamOpenCall,
      ) => AsyncIterable<StreamItem> | Promise<AsyncIterable<StreamItem>>)
    | null = null;

  const configRef = options?.configRef ?? {
    id: "config.orders.stream",
    revision: "rev.1",
  };
  const providerId = options?.providerId ?? "orders.stream";
  const bindingId = options?.bindingId ?? "binding.orders.stream";

  const provider = signalProvider({
    id: providerId,
    transport: stream({
      async open(context) {
        const call: StreamOpenCall = {
          cursor: context.cursor,
          configRef: context.configRef,
          signal: context.signal,
        };
        openCalls.push(call);
        if (!itemFactory) {
          return emptyIterable();
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
        context: StreamOpenCall,
      ) => AsyncIterable<StreamItem> | Promise<AsyncIterable<StreamItem>>,
    ): void {
      itemFactory = factory;
    },
    setItemSequence(items: readonly StreamItem[]): void {
      itemFactory = async function* () {
        for (const item of items) {
          yield item;
        }
      };
    },
  };
}

export function sampleCheckpoint(options: {
  readonly namespace: string;
  readonly bindingId: string;
  readonly cursor: string | null;
  readonly lastOwnerId?: string;
  readonly configRef?: RuntimeTransportConfigRef;
  readonly status?: RuntimeTransportBindingCheckpoint["status"];
  readonly lastErrorCode?: string;
}): RuntimeTransportBindingCheckpoint {
  return Object.freeze({
    schemaVersion: 1 as const,
    namespace: options.namespace,
    bindingId: options.bindingId,
    cursor: options.cursor,
    updatedAt: "2026-08-07T12:00:00.000Z",
    lastPolledAt: "2026-08-07T12:00:00.000Z",
    ...(options.lastOwnerId !== undefined
      ? { lastOwnerId: options.lastOwnerId }
      : {}),
    ...(options.configRef !== undefined ? { configRef: options.configRef } : {}),
    ...(options.status !== undefined ? { status: options.status } : {}),
    ...(options.lastErrorCode !== undefined
      ? { lastErrorCode: options.lastErrorCode }
      : {}),
  });
}

async function* emptyIterable(): AsyncGenerator<StreamItem, void, unknown> {
  // Clean EOF with no items.
}
