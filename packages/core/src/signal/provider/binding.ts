/**
 * Inert Runtime managed-transport binding projection for Signal providers.
 *
 * @module
 */

import type {
  RuntimeManagedTransportBinding,
  RuntimeTransportConfigRef,
} from "../../runtime/transport/contracts";
import { validateRuntimeManagedTransportBinding } from "../../runtime/transport/validation";
import type { SignalProvider, SignalProviderSignals } from "./signal-provider";

/** Options for projecting one live provider into an inert Runtime binding. */
export interface ManagedTransportBindingOptions {
  /** Stable binding identity retained by the Runtime program. */
  readonly id: string;
  /** Canonical configuration reference without secrets. */
  readonly configRef: RuntimeTransportConfigRef;
  /**
   * Declared Signal identity this binding routes toward.
   *
   * @remarks Must match one authored Signal id from the provider map.
   */
  readonly signalId: string;
  /**
   * Optional provider system name for the adapter declaration.
   *
   * @remarks Defaults to the provider id. Never a credential or live client.
   */
  readonly provider?: string;
  /**
   * Optional adapter identity for the inert declaration.
   *
   * @remarks Defaults to the provider id.
   */
  readonly adapterId?: string;
}

/**
 * Project a live Signal provider into an inert managed-transport binding.
 *
 * @remarks The returned value contains only serializable declaration data. It
 * never captures `handle`, `poll`, `onEvent`, credentials, Requests, or
 * process-local clients, and is suitable for immutable Runtime program
 * generation.
 *
 * @param provider - Frozen Signal provider definition.
 * @param options - Binding identity, config reference, and Signal target.
 * @returns A validated, frozen `RuntimeManagedTransportBinding`.
 */
export function managedTransportBinding<
  TId extends string,
  TSignals extends SignalProviderSignals,
>(
  provider: SignalProvider<TId, TSignals>,
  options: ManagedTransportBindingOptions,
): RuntimeManagedTransportBinding {
  if (provider._tag !== "SignalProvider") {
    throw new TypeError(
      "managedTransportBinding() requires a signalProvider() definition.",
    );
  }

  const signalIds = new Set(
    Object.values(provider.signals).map((entry) => entry.id),
  );
  if (!signalIds.has(options.signalId)) {
    throw new TypeError(
      `managedTransportBinding() signalId \`${options.signalId}\` is not declared by provider \`${provider.id}\`.`,
    );
  }

  return validateRuntimeManagedTransportBinding({
    _tag: "RuntimeManagedTransportBinding",
    id: options.id,
    adapter: {
      _tag: "RuntimeManagedTransportAdapter",
      id: options.adapterId ?? provider.id,
      provider: options.provider ?? provider.id,
      acceptedEnvelopeVersion: 1,
    },
    configRef: options.configRef,
    target: {
      kind: "signal",
      signalId: options.signalId,
    },
  });
}
