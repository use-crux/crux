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
        'Use node(), convex(), or serverless({ store: postgres(), wake: qstash() }).',
    }
  }
  if (!capabilities.waiters.durable) {
    return {
      name: 'durable waiter registration',
      why: 'Runtime-bound waits must survive after the current process exits.',
      nextStep:
        'Choose a runtime adapter with durable waiters, such as node() for local use or postgres() for serverless use.',
    }
  }
  if (!capabilities.timers.durable) {
    return {
      name: 'durable timers',
      why: 'Runtime timers must be recorded before a flow can safely suspend with a timeout.',
      nextStep:
        'Choose a runtime adapter with durable timers or a store-backed timer scanner.',
    }
  }
  if (!capabilities.wake.atLeastOnce) {
    return {
      name: 'at-least-once wake delivery',
      why: 'Runtime work can only be reliable when wake delivery is retried until the kernel handles it idempotently.',
      nextStep:
        'Configure a wake adapter that can deliver at least once, such as node() locally or qstash() in serverless deployments.',
    }
  }
  if (!capabilities.leases.durable) {
    return {
      name: 'durable leases',
      why: 'The kernel needs leases to exclude concurrent workers while still recovering expired attempts.',
      nextStep:
        'Use a runtime store adapter that implements the LeasePort contract.',
    }
  }
  return undefined
}
