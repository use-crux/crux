/**
 * Capability preflight for Runtime Engine composers.
 *
 * The kernel still checks critical behavior at runtime, but composer
 * resolution should fail early when an adapter honestly cannot support the
 * durable guarantees required by runtime-bound APIs.
 *
 * @module
 */

import type { CruxEngineCapabilities } from '../ports'
import { createRuntimeError } from '../engine/errors'
import type { RuntimeEngineDefinition } from './runtime-definition'

const RUNTIME_ADAPTER_GUIDE_URL =
  'https://cruxjs.dev/docs/guides/durable-execution/custom-adapters'

/** Throw `CAPABILITY_MISSING` when a runtime composer lacks required support. */
export function assertRuntimeCapabilities(
  runtime: RuntimeEngineDefinition,
): void {
  const missing = requiredCapability(runtime.capabilities)
  if (!missing) return
  throw createRuntimeError({
    code: 'CAPABILITY_MISSING',
    whatFailed: `Runtime adapter \`${runtime.id}\` is missing ${missing.name}.`,
    why: missing.why,
    whatStillWorks:
      'Object-bound flow APIs and non-runtime Crux features still work.',
    nextStep: missing.nextStep,
  })
}

function requiredCapability(
  capabilities: CruxEngineCapabilities,
): { readonly name: string; readonly why: string; readonly nextStep: string } | undefined {
  if (!capabilities.events.durable || !capabilities.events.cursorReads) {
    return {
      name: 'durable event cursor reads',
      why: 'Runtime waits and signal delivery need an append-only event log with resumable cursors.',
      nextStep:
        `Choose a Runtime Engine adapter that implements durable event cursor reads, then run its setup check or conformance tests. See ${RUNTIME_ADAPTER_GUIDE_URL}.`,
    }
  }
  if (!capabilities.waiters.durable) {
    return {
      name: 'durable waiter registration',
      why: 'Runtime-bound waits must survive after the current process exits.',
      nextStep:
        `Choose a Runtime Engine adapter that implements durable waiters, then run its setup check or conformance tests. See ${RUNTIME_ADAPTER_GUIDE_URL}.`,
    }
  }
  if (!capabilities.timers.durable) {
    return {
      name: 'durable timers',
      why: 'Runtime timers must be recorded before a flow can safely suspend with a timeout.',
      nextStep:
        `Choose a Runtime Engine adapter that implements durable timers or a store-backed timer scanner. See ${RUNTIME_ADAPTER_GUIDE_URL}.`,
    }
  }
  if (!capabilities.wake.atLeastOnce) {
    return {
      name: 'at-least-once wake delivery',
      why: 'Runtime work can only be reliable when wake delivery is retried until the kernel handles it idempotently.',
      nextStep:
        `Configure wake delivery that can deliver at least once, then run a wake-handler smoke test. See ${RUNTIME_ADAPTER_GUIDE_URL}.`,
    }
  }
  if (!capabilities.leases.durable) {
    return {
      name: 'durable leases',
      why: 'The kernel needs leases to exclude concurrent workers while still recovering expired attempts.',
      nextStep:
        `Choose a Runtime Engine store adapter that implements the LeasePort contract, then run the store conformance suite. See ${RUNTIME_ADAPTER_GUIDE_URL}.`,
    }
  }
  return undefined
}
