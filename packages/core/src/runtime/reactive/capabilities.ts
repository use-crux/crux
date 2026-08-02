/**
 * Mechanical capability checks for reactive Runtime profiles.
 *
 * @module
 */

import type { ResolvedRuntimeEngine } from "../api/create-runtime";

/** Mechanical Runtime capabilities used by reactive semantic profiles. */
export type ReactiveMechanicalCapability =
  | "composites.atomic"
  | "events.durable"
  | "events.cursor-reads"
  | "leases.durable"
  | "signals.storage"
  | "storage.durable"
  | "waiters.durable"
  | "wake.at-least-once";

type CapabilityCheck = (runtime: ResolvedRuntimeEngine) => boolean;

/** Mechanical capability probes keyed independently from semantic profiles. */
export const REACTIVE_CAPABILITY_CHECKS = {
  "composites.atomic": (runtime) =>
    typeof runtime.store.transact === "function",
  "events.durable": (runtime) => runtime.capabilities.events.durable,
  "events.cursor-reads": (runtime) => runtime.capabilities.events.cursorReads,
  "leases.durable": (runtime) => runtime.capabilities.leases.durable,
  "signals.storage": (runtime) => runtime.store.signals !== undefined,
  "storage.durable": (runtime) => runtime.store.durability === "durable",
  "waiters.durable": (runtime) => runtime.capabilities.waiters.durable,
  "wake.at-least-once": (runtime) => runtime.capabilities.wake.atLeastOnce,
} satisfies Readonly<Record<ReactiveMechanicalCapability, CapabilityCheck>>;
