/**
 * Typed reactive capability profiles.
 *
 * @module
 */

import type { ReactiveMechanicalCapability } from "./capabilities";

/** Semantic reactive guarantee checked before Runtime activation. */
export type ReactiveCapabilityProfile =
  | "signal.durable-delivery"
  | "signal.process-local";

interface ReactiveCapabilityProfileDefinition {
  readonly requires: readonly ReactiveMechanicalCapability[];
}

/** Mechanical requirements for each reactive semantic guarantee. */
export const REACTIVE_CAPABILITY_PROFILES = {
  "signal.durable-delivery": {
    requires: [
      "storage.durable",
      "signals.storage",
      "composites.atomic",
      "events.durable",
      "events.cursor-reads",
      "waiters.durable",
      "wake.at-least-once",
      "leases.durable",
    ],
  },
  "signal.process-local": { requires: [] },
} satisfies Readonly<
  Record<ReactiveCapabilityProfile, ReactiveCapabilityProfileDefinition>
>;
