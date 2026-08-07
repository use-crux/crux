/**
 * Provider-neutral Signal transport authoring surface.
 *
 * @module
 */

import type { PollingTransport } from "./polling";
import type { WebhookTransport } from "./webhook";

export { webhook } from "./webhook";
export type {
  WebhookHandle,
  WebhookHandleResult,
  WebhookOptions,
  WebhookTransport,
} from "./webhook";

export { polling } from "./polling";
export type {
  PollContext,
  PollEvent,
  PollHandle,
  PollingOptions,
  PollingTransport,
  PollResult,
} from "./polling";

/** Live transport definitions accepted by {@link import("../provider").signalProvider}. */
export type SignalProviderTransport = WebhookTransport | PollingTransport;
