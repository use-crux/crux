/**
 * Shared fixtures for managed polling supervision tests.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

import { signal } from "../../src/signal";
import { polling } from "../../src/signal/transport";
import {
  managedTransportBinding,
  signalProvider,
} from "../../src/signal/provider";
import {
  createRuntimeProgram,
  type RuntimeAcceptedTransportPayload,
  type RuntimeTransportBindingCheckpoint,
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

export function createPollingFixture(options?: {
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

export function createNamedPollingFixture(
  name: string,
  page: {
    readonly events: string[];
    readonly next: string | null;
    readonly failPoll?: boolean;
  },
) {
  const orderSubmitted = signal({
    id: "order.submitted",
    schema: z.object({ orderId: z.string() }),
  });
  const pollCalls: Array<{ cursor: string | null }> = [];
  let failPoll = page.failPoll === true;
  const provider = signalProvider({
    id: `orders.poll.${name}`,
    transport: polling({
      async poll({ cursor, signal: abortSignal }) {
        if (abortSignal.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        pollCalls.push({ cursor });
        if (failPoll) {
          failPoll = false;
          throw Object.assign(new Error("provider unavailable"), {
            code: "PROVIDER_UNAVAILABLE",
          });
        }
        return {
          events: page.events.map((eventId) => ({
            accountId: "acct_1",
            eventId: `${name}:${eventId}`,
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
    async onEvent() {},
  });
  const binding = managedTransportBinding(provider, {
    id: `binding.orders.poll.${name}`,
    configRef: { id: `config.orders.poll.${name}`, revision: "rev.1" },
    signalId: "order.submitted",
  });
  return { provider, binding, pollCalls };
}

export function sampleCheckpoint(options: {
  readonly namespace: string;
  readonly bindingId: string;
  readonly cursor: string | null;
  readonly lastOwnerId?: string;
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
  });
}
