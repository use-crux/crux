/**
 * Provider-neutral Signal provider authoring.
 *
 * @module
 */

import type { Signal } from "../definition";
import type { SignalSchema } from "../schema-types";
import type {
  PollingTransport,
  SignalProviderTransport,
  StreamTransport,
  WebhookTransport,
} from "../transport";
import type { RuntimeAcceptedTransportEnvelope } from "../../runtime/transport/contracts";

export type { SignalProviderTransport };

/**
 * Minimal structural bound for one provider Signal map member.
 *
 * @remarks Full `Signal<string, SignalSchema>` is invariant through `when()`,
 * so concrete `Signal<literal, ZodObject>` values are not assignable to that
 * broad form under some compilers (including TypeScript-Go preview). This
 * bound checks Signal identity without collapsing per-key payload inference.
 */
export type SignalProviderSignalMember = {
  readonly _tag: "Signal";
  readonly id: string;
  readonly schema: SignalSchema;
};

/**
 * Declared Signal map retained by one provider for exact publication typing.
 *
 * @remarks Prefer {@link SignalProviderSignalsConstraint} at authoring bounds so
 * each inferred member retains its concrete Signal type while non-Signal
 * values are rejected. This index type is the wide public form for defaults.
 */
export type SignalProviderSignals = {
  readonly [Name in string]: SignalProviderSignalMember;
};

/**
 * Self-constraint that validates each map member is a Signal.
 *
 * @remarks Uses conditional inference rather than assignability to the
 * invariant `Signal<string, SignalSchema>` form, so concrete Signal values
 * remain exact across TypeScript 5.5+, 6.0, and TypeScript-Go preview.
 *
 * @typeParam TSignals - Candidate Signal map to validate.
 */
export type SignalProviderSignalsConstraint<TSignals> = {
  readonly [K in keyof TSignals]: TSignals[K] extends Signal<
    infer _Id extends string,
    infer _Schema extends SignalSchema
  >
    ? TSignals[K]
    : never;
};

/**
 * Context supplied to {@link SignalProvider.onEvent} after durable acceptance.
 *
 * @typeParam TSignals - Exact Signal map authored on the provider.
 */
export interface SignalProviderEventContext<
  TSignals extends SignalProviderSignals,
> {
  /**
   * Exact declared Signal map; only these Signals may be published.
   *
   * @remarks Normalization scopes each `publish()` to the accepted provider
   * event. When `idempotencyKey` is omitted, publication defaults to the
   * accepted provider/account/event identity so crash recovery cannot create a
   * second logical delivery for the same envelope.
   */
  readonly signals: TSignals;
}

/**
 * Normalize one accepted transport envelope into declared Signal publications.
 *
 * @remarks Invoked after durable acceptance and claim. Publications use the
 * ordinary Signal API and inherit its process-local or durable guarantee.
 * Hosts must invoke normalization only through the transport runner/helpers so
 * provider Signals remain scoped to the accepted event identity.
 */
export type SignalProviderOnEvent<TSignals extends SignalProviderSignals> = (
  envelope: RuntimeAcceptedTransportEnvelope,
  context: SignalProviderEventContext<TSignals>,
) => void | Promise<void>;

/**
 * Options accepted by {@link signalProvider}.
 *
 * @typeParam TId - Literal provider identity.
 * @typeParam TSignals - Exact Signal map declared for publication.
 */
export interface SignalProviderOptions<
  TId extends string,
  TSignals extends SignalProviderSignals,
> {
  /** Stable application-owned provider identity. */
  readonly id: TId;
  /**
   * Transport that authenticates raw ingress before acceptance.
   *
   * @remarks Webhook transports are host-edge driven. Polling and managed
   * stream transports are acquired by the single Runtime worker through the
   * shared supervision loop.
   */
  readonly transport: SignalProviderTransport;
  /**
   * Signals this provider may publish.
   *
   * @remarks Exact key and Signal types are preserved for `onEvent` inference.
   */
  readonly signals: TSignals;
  /**
   * Normalize one accepted envelope into zero or more Signal publications.
   *
   * @remarks Retained as process code on the live definition. Inert
   * `RuntimeManagedTransportBinding` projections never capture this callback.
   */
  readonly onEvent: SignalProviderOnEvent<TSignals>;
}

/**
 * Frozen Signal provider definition.
 *
 * @remarks Live definitions retain transport and event callbacks for edge and
 * normalization hosts. Deployed Runtime program bindings use only the inert
 * projection produced by {@link managedTransportBinding}.
 *
 * @typeParam TId - Literal provider identity.
 * @typeParam TSignals - Exact declared Signal map.
 */
export interface SignalProvider<
  TId extends string = string,
  TSignals extends SignalProviderSignals = SignalProviderSignals,
> {
  /** Stable definition discriminant. */
  readonly _tag: "SignalProvider";
  /** Literal application-owned provider identity. */
  readonly id: TId;
  /** Authored transport definition (webhook, polling, or managed stream). */
  readonly transport: SignalProviderTransport;
  /** Exact declared Signal map. */
  readonly signals: TSignals;
  /**
   * Normalization callback retained for restart-safe claim handlers.
   *
   * @remarks Declared as a method so host registries may accept exact provider
   * instances without losing Signal-map inference at the authoring site.
   */
  onEvent(
    envelope: RuntimeAcceptedTransportEnvelope,
    context: SignalProviderEventContext<TSignals>,
  ): void | Promise<void>;
}

/**
 * Declare a Signal provider without registering it or opening a listener.
 *
 * @param options - Provider identity, transport, Signal map, and normalizer.
 * @returns A frozen provider definition with exact Signal-map inference.
 *
 * @example
 * ```ts
 * import { signal } from "@use-crux/core/signal";
 * import { webhook } from "@use-crux/core/signal/transport";
 * import { signalProvider } from "@use-crux/core/signal/provider";
 *
 * const orderSubmitted = signal({ id: "order.submitted", schema });
 *
 * export const orders = signalProvider({
 *   id: "orders.webhook",
 *   transport: webhook({ handle }),
 *   signals: { orderSubmitted },
 *   async onEvent(envelope, { signals }) {
 *     await signals.orderSubmitted.publish(map(envelope), {
 *       idempotencyKey: envelope.eventId,
 *     });
 *   },
 * });
 * ```
 */
export function signalProvider<
  const TId extends string,
  const TSignals extends SignalProviderSignalsConstraint<TSignals> &
    SignalProviderSignals,
>(
  options: SignalProviderOptions<TId, TSignals>,
): SignalProvider<TId, TSignals> {
  if (!options.id || options.id.trim() !== options.id) {
    throw new TypeError("signalProvider({ id }) requires a non-empty trimmed id.");
  }
  if (!isSignalProviderTransport(options.transport)) {
    throw new TypeError(
      "signalProvider({ transport }) requires a webhook(), polling(), or stream() transport definition.",
    );
  }
  if (
    options.signals === null ||
    typeof options.signals !== "object" ||
    Array.isArray(options.signals)
  ) {
    throw new TypeError("signalProvider({ signals }) requires a Signal map.");
  }
  if (typeof options.onEvent !== "function") {
    throw new TypeError("signalProvider({ onEvent }) requires an onEvent function.");
  }

  const signals = Object.freeze({ ...options.signals }) as TSignals;
  return Object.freeze({
    _tag: "SignalProvider" as const,
    id: options.id,
    transport: options.transport,
    signals,
    onEvent: options.onEvent,
  });
}

function isSignalProviderTransport(
  value: unknown,
): value is SignalProviderTransport {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const transport = value as {
    readonly _tag?: unknown;
    readonly handle?: unknown;
    readonly poll?: unknown;
    readonly open?: unknown;
  };

  if (transport._tag === "WebhookTransport") {
    return typeof transport.handle === "function";
  }

  if (transport._tag === "PollingTransport") {
    return typeof transport.poll === "function";
  }

  if (transport._tag === "StreamTransport") {
    return typeof transport.open === "function";
  }

  return false;
}

/** Type-narrow a provider transport to the polling form. */
export function isPollingTransport(
  transport: SignalProviderTransport,
): transport is PollingTransport {
  return transport._tag === "PollingTransport";
}

/** Type-narrow a provider transport to the webhook form. */
export function isWebhookTransport(
  transport: SignalProviderTransport,
): transport is WebhookTransport {
  return transport._tag === "WebhookTransport";
}

/** Type-narrow a provider transport to the managed stream form. */
export function isStreamTransport(
  transport: SignalProviderTransport,
): transport is StreamTransport {
  return transport._tag === "StreamTransport";
}
