/**
 * Immutable Runtime program construction and canonical validation.
 *
 * @module
 */

import { sha256Hex } from "../content/sha256";
import { createRuntimeError } from "./engine/errors";
import {
  canonicalizeRuntimeHandlerTargets,
  runtimeHandlerTargetIdentity,
  type RuntimeHandlerTarget,
} from "./handler/targets";
import type { RuntimeManagedTransportBinding } from "./transport";
import { validateRuntimeManagedTransportBinding } from "./transport";

const encoder = new TextEncoder();

/** Immutable executable target and managed-transport truth for one project. */
export interface RuntimeProgram {
  /** SHA-256 of the canonical program declaration. */
  readonly manifestHash: string;
  /** Canonically ordered executable Runtime target declarations. */
  readonly targets: readonly RuntimeHandlerTarget[];
  /** Canonically ordered, inert managed-transport bindings. */
  readonly transports: readonly RuntimeManagedTransportBinding[];
}

/** Declarations accepted by {@link createRuntimeProgram}. */
export interface CreateRuntimeProgramOptions {
  /** Statically imported Flow handles and durable task targets. */
  readonly targets: readonly RuntimeHandlerTarget[];
  /** Inert provider-neutral managed-transport bindings. */
  readonly transports: readonly RuntimeManagedTransportBinding[];
}

/**
 * Validate and canonicalize one immutable Runtime program.
 *
 * Generated artifacts and hand-written hosts use this same pure construction
 * path. It performs no registration, discovery, configuration lookup, or I/O.
 */
export function createRuntimeProgram(
  options: CreateRuntimeProgramOptions,
): RuntimeProgram {
  const targets = canonicalizeRuntimeHandlerTargets(
    options.targets,
    "createRuntimeProgram()",
  );
  const transports = canonicalizeTransports(options.transports);
  validateSignalTargets(targets, transports);
  validateAdapterDeclarations(transports);

  const manifestHash = sha256Hex(
    encoder.encode(
      JSON.stringify({
        format: "crux-runtime-program:v1",
        targets: targets.map(targetManifestEntry),
        transports,
      }),
    ),
  );
  return Object.freeze({ manifestHash, targets, transports });
}

function canonicalizeTransports(
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
  return Object.freeze(canonical);
}

function validateSignalTargets(
  targets: readonly RuntimeHandlerTarget[],
  transports: readonly RuntimeManagedTransportBinding[],
): void {
  const targetIds = new Set(targets.map(runtimeHandlerTargetIdentity));
  for (const transport of transports) {
    if (!targetIds.has(transport.target.signalId)) {
      unresolvedSignalTarget(transport);
    }
  }
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

function targetManifestEntry(target: RuntimeHandlerTarget): {
  readonly id: string;
  readonly kind: "flow" | "task" | null;
} {
  return {
    id: runtimeHandlerTargetIdentity(target),
    kind: "kind" in target ? target.kind : null,
  };
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

function unresolvedSignalTarget(
  transport: RuntimeManagedTransportBinding,
): never {
  throw createRuntimeError({
    code: "TARGET_NOT_FOUND",
    whatFailed: `Runtime transport binding \`${transport.id}\` targets undeclared Signal \`${transport.target.signalId}\`.`,
    why: "Every managed transport destination must resolve within the same Runtime program.",
    whatStillWorks: "Bindings whose Signal targets are declared remain valid.",
    nextStep: `Add the static target \`${transport.target.signalId}\` or correct binding \`${transport.id}\`.`,
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
