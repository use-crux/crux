/**
 * Scope provider Signal publication to one accepted transport event.
 *
 * @module
 */

import type { Signal } from "../../signal/definition";
import type { SignalSchema } from "../../signal/schema-types";
import type {
  SignalProviderSignals,
} from "../../signal/provider/signal-provider";
import type { SignalPublishOptions } from "../../signal/publication";
import type { RuntimeAcceptedTransportEnvelope } from "./contracts";

/**
 * Default publication idempotency key for one accepted provider event.
 *
 * @remarks Scoped per Signal definition by the ordinary Signal idempotency
 * ledger, so multi-Signal fan-out from one event remains independent.
 */
export function transportPublicationIdempotencyKey(
  envelope: RuntimeAcceptedTransportEnvelope,
): string {
  return `crux.transport.v1:${envelope.provider}:${envelope.accountId}:${envelope.eventId}`;
}

/**
 * Wrap a provider Signal map so omitted publish keys default to the accepted
 * event identity.
 *
 * @remarks Keeps the ordinary {@link Signal.publish} surface. An explicit
 * `idempotencyKey` still wins. Crash recovery after successful publication but
 * before envelope completion therefore cannot create a second logical
 * delivery for the same accepted provider event.
 */
export function scopeProviderSignalsForEnvelope<
  TSignals extends SignalProviderSignals,
>(
  signals: TSignals,
  envelope: RuntimeAcceptedTransportEnvelope,
): TSignals {
  const defaultKey = transportPublicationIdempotencyKey(envelope);
  const scoped: Record<string, Signal<string, SignalSchema>> = {};
  for (const [name, definition] of Object.entries(signals)) {
    scoped[name] = Object.freeze({
      ...definition,
      publish(
        payload: Parameters<typeof definition.publish>[0],
        options?: SignalPublishOptions,
      ) {
        return definition.publish(payload, {
          ...options,
          idempotencyKey: options?.idempotencyKey ?? defaultKey,
        });
      },
    });
  }
  return Object.freeze(scoped) as TSignals;
}
