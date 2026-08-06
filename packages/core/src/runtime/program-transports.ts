/**
 * Canonical inert managed-transport declarations for Runtime programs.
 *
 * @module
 */

import { createRuntimeError } from "./engine/errors";
import type { RuntimeManagedTransportBinding } from "./transport";
import { validateRuntimeManagedTransportBinding } from "./transport";

/**
 * Validate, freeze, and order managed-transport bindings by stable id.
 *
 * @param transports - Inert provider-neutral bindings.
 * @returns Canonically ordered frozen bindings.
 */
export function canonicalizeProgramTransports(
  transports: readonly RuntimeManagedTransportBinding[],
): readonly RuntimeManagedTransportBinding[] {
  const canonical = transports
    .map((transport) => validateRuntimeManagedTransportBinding(transport))
    .sort((left, right) => compareText(left.id, right.id));
  for (let index = 1; index < canonical.length; index += 1) {
    if (canonical[index - 1]?.id === canonical[index]?.id) {
      duplicateBinding(canonical[index]!.id);
    }
  }
  validateAdapterDeclarations(canonical);
  return Object.freeze(canonical);
}

function validateAdapterDeclarations(
  transports: readonly RuntimeManagedTransportBinding[],
): void {
  const adapters = new Map<string, RuntimeManagedTransportBinding["adapter"]>();
  for (const transport of transports) {
    const previous = adapters.get(transport.adapter.id);
    if (previous && previous.provider !== transport.adapter.provider) {
      incompatibleAdapter(transport);
    }
    adapters.set(transport.adapter.id, transport.adapter);
  }
}

function duplicateBinding(id: string): never {
  throw createRuntimeError({
    code: "TARGET_DUPLICATE",
    whatFailed: `Runtime transport binding \`${id}\` is declared more than once.`,
    why: "A Runtime program needs one stable declaration for each binding identity.",
    whatStillWorks:
      "Other uniquely identified targets and bindings remain valid.",
    nextStep: `Remove or rename the duplicate binding \`${id}\`.`,
  });
}

function incompatibleAdapter(transport: RuntimeManagedTransportBinding): never {
  throw createRuntimeError({
    code: "CAPABILITY_MISSING",
    whatFailed: `Runtime transport adapter \`${transport.adapter.id}\` has incompatible declarations.`,
    why: "One adapter identity cannot name different providers in the same Runtime program.",
    whatStillWorks:
      "Bindings with unique or compatible adapter declarations remain valid.",
    nextStep: `Use one canonical provider declaration for adapter \`${transport.adapter.id}\`.`,
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
