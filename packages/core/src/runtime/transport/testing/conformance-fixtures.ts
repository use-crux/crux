/**
 * Shared fixtures for managed-transport store conformance.
 *
 * @module
 */

import { z } from "zod";
import { sha256Hex } from "../../../content/sha256";
import type { SignalProvider } from "../../../signal/provider";
import { signal } from "../../../signal/definition";
import { webhook } from "../../../signal/transport";
import { signalProvider } from "../../../signal/provider";
import type { RuntimeAcceptedTransportEnvelope } from "../contracts";

/** Create a Signal provider that publishes one order id per accepted envelope. */
export function createConformanceTransportProvider(): {
  readonly provider: SignalProvider;
  readonly published: string[];
} {
  const orderSubmitted = signal({
    id: "order.submitted",
    schema: z.object({ orderId: z.string() }),
  });
  const published: string[] = [];
  orderSubmitted.subscribe((occurrence) => {
    published.push(occurrence.payload.orderId);
  });
  const provider = signalProvider({
    id: "orders.webhook",
    transport: webhook({
      async handle() {
        throw new Error("unused");
      },
    }),
    signals: { orderSubmitted },
    async onEvent(envelope, { signals }) {
      const raw =
        envelope.payload.kind === "inline-base64url"
          ? Buffer.from(envelope.payload.value, "base64url").toString("utf8")
          : "";
      const body = JSON.parse(raw) as { orderId: string };
      // Omit explicit keys so crash-safe default scoping is exercised.
      await signals.orderSubmitted.publish({ orderId: body.orderId });
    },
  });
  return { provider, published };
}

/** Build one accepted transport envelope for conformance laws. */
export function sampleConformanceEnvelope(
  eventId: string,
  body: { orderId: string } = { orderId: "ord_1" },
): RuntimeAcceptedTransportEnvelope {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const value = encodeBase64Url(bytes);
  const sha256 = sha256Hex(bytes);
  return {
    _tag: "RuntimeAcceptedTransportEnvelope",
    schemaVersion: 1,
    bindingId: "binding.orders",
    adapterId: "orders.webhook",
    provider: "orders.webhook",
    accountId: "acct_1",
    eventId,
    receivedAt: "2026-08-04T12:00:00.000Z",
    authenticatedRouting: { source: "webhook" },
    payload: {
      kind: "inline-base64url",
      value,
      byteLength: bytes.byteLength,
      sha256,
    },
    configRef: { id: "config.orders", revision: "rev.1" },
    target: { kind: "signal", signalId: "order.submitted" },
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
