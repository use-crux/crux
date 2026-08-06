/**
 * Transport normalization drain for the existing Runtime worker loop.
 *
 * @remarks Extends the one #336 worker with a bounded claim/normalize pass over
 * accepted Signal-provider envelopes. No second worker, queue, daemon, or
 * transport lifecycle is introduced.
 *
 * @module
 */

import type { RuntimeProgram } from "../program";
import {
  createTransportNormalizationRunner,
  type TransportNormalizationRunner,
} from "../transport";
import type { RuntimeStoreAdapter } from "../store";
import { createRuntimeError } from "../engine/errors";
import { resolveProgramProvider } from "../program-providers";

/** Options for building the worker-owned transport drain. */
export interface CreateWorkerTransportDrainOptions {
  /** Immutable program providing executable providers and inert bindings. */
  readonly program: RuntimeProgram;
  /** Runtime store that owns the transport port. */
  readonly store: RuntimeStoreAdapter;
  /** Runtime namespace scanned for accepted envelopes. */
  readonly namespace: string;
}

/**
 * Create a transport drain for the worker maintenance loop, or `undefined`
 * when the program declares no managed transports.
 *
 * @param options - Program authority, store, and namespace.
 * @returns A host-free runner invoked once per worker tick, or `undefined`.
 * @throws When a declared binding cannot resolve to an executable provider.
 */
export function createWorkerTransportDrain(
  options: CreateWorkerTransportDrainOptions,
): TransportNormalizationRunner | undefined {
  if (options.program.transports.length === 0) return undefined;

  if (!options.store.transports) {
    throw createRuntimeError({
      code: "CAPABILITY_MISSING",
      whatFailed:
        "Runtime worker cannot drain managed transports without a store transports capability.",
      why: "Programs that declare managed-transport bindings require the optional Runtime store transports port before the worker starts.",
      whatStillWorks:
        "Queued Work maintenance still runs for executable targets when transports are omitted from the program.",
      nextStep:
        "Use a Runtime store that implements the transports port, or remove managed-transport bindings from createRuntimeProgram({ transports }).",
    });
  }

  for (const binding of options.program.transports) {
    if (!resolveProgramProvider(options.program.providers, binding)) {
      throw createRuntimeError({
        code: "CAPABILITY_MISSING",
        whatFailed: `Runtime worker cannot resolve provider for transport binding \`${binding.id}\`.`,
        why: "The existing Runtime worker drains accepted envelopes only for program-declared provider authority.",
        whatStillWorks:
          "Queued Work maintenance still runs for executable targets in the same program.",
        nextStep:
          `Pass the matching signalProvider() in createRuntimeProgram({ providers }) for adapter \`${binding.adapter.id}\`.`,
      });
    }
  }

  return createTransportNormalizationRunner({
    store: options.store,
    namespace: options.namespace,
    providers: options.program.providers,
  });
}
