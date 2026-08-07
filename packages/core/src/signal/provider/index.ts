/**
 * Provider-neutral Signal provider authoring surface.
 *
 * @module
 */

export {
  isPollingTransport,
  isWebhookTransport,
  signalProvider,
} from "./signal-provider";
export type {
  SignalProvider,
  SignalProviderEventContext,
  SignalProviderOnEvent,
  SignalProviderOptions,
  SignalProviderSignalMember,
  SignalProviderSignals,
  SignalProviderSignalsConstraint,
  SignalProviderTransport,
} from "./signal-provider";
export { managedTransportBinding } from "./binding";
export type { ManagedTransportBindingOptions } from "./binding";
