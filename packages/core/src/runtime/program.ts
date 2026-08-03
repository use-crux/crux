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
import type { RuntimeTargetDefinitionRef } from "./ports/target-definition";
import { isAgent, type AnyAgent } from "../agent";
import type { GenerationModel } from "../generation-model";
import {
  canonicalizeProgramGenerationModels,
  generationModelManifestEntry,
  targetGenerationModelReference,
} from "./program-generation-models";

const encoder = new TextEncoder();

/** Executable Runtime target declaration with an explicit durable kind. */
export type RuntimeProgramTarget =
  | AnyAgent
  | (Exclude<RuntimeHandlerTarget, AnyAgent> & {
      readonly kind: "flow" | "task" | "agent";
    });

/** Immutable executable target, definition, and managed-transport truth for one project. */
export interface RuntimeProgram {
  /** SHA-256 of the canonical program declaration. */
  readonly manifestHash: string;
  /** Canonically ordered executable Runtime target declarations. */
  readonly targets: readonly RuntimeProgramTarget[];
  /** Generated definition identity for each executable target. */
  readonly targetDefinitions: readonly RuntimeProgramTargetDefinition[];
  /** Canonically ordered, statically declared generation models. */
  readonly generationModels: readonly GenerationModel[];
  /** Canonically ordered, inert managed-transport bindings. */
  readonly transports: readonly RuntimeManagedTransportBinding[];
}

/** Generated identity supplied beside one statically imported target. */
export interface RuntimeProgramTargetDefinitionInput {
  /** Exact Project Index definition identity. */
  readonly id: string;
  /** Exact Project Index definition fingerprint. */
  readonly fingerprint: string;
}

/** A target paired with generated definition metadata. */
export interface RuntimeProgramTargetDeclaration {
  /** Statically imported executable target. */
  readonly target: RuntimeProgramTarget;
  /** Generated identity for the imported definition. */
  readonly definition: RuntimeProgramTargetDefinitionInput;
}

/** Canonical target metadata retained by an immutable Runtime program. */
export type RuntimeProgramTargetDefinition = Omit<
  RuntimeTargetDefinitionRef,
  "manifestHash"
>;

/** Target input accepted by generated and hand-written Runtime programs. */
export type RuntimeProgramTargetInput =
  | RuntimeProgramTarget
  | RuntimeProgramTargetDeclaration;

/** Declarations accepted by {@link createRuntimeProgram}. */
export interface CreateRuntimeProgramOptions {
  /** Statically imported Flow, durable task, and Agent targets. */
  readonly targets: readonly RuntimeProgramTargetInput[];
  /** Statically imported generation models available to Session selection. */
  readonly generationModels?: readonly GenerationModel[];
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
  const declarations = options.targets.map(normalizeTargetDeclaration);
  const targets = canonicalizeRuntimeHandlerTargets(
    declarations.map((declaration) => declaration.target),
    "createRuntimeProgram()",
  );
  const targetDefinitions = canonicalTargetDefinitions(targets, declarations);
  const generationModels = canonicalizeProgramGenerationModels(
    options.generationModels ?? [],
    targets,
  );
  const transports = canonicalizeTransports(options.transports);
  validateSignalTargets(targets, transports);
  validateAdapterDeclarations(transports);

  const manifestHash = sha256Hex(
    encoder.encode(
      JSON.stringify({
        format: "crux-runtime-program:v1",
        targets: targets.map((target, index) => ({
          ...targetManifestEntry(target),
          definition: targetDefinitions[index],
          generationModel: targetGenerationModelReference(target),
        })),
        generationModels: generationModels.map(generationModelManifestEntry),
        transports,
      }),
    ),
  );
  return Object.freeze({
    manifestHash,
    targets,
    targetDefinitions,
    generationModels,
    transports,
  });
}

function normalizeTargetDeclaration(
  input: RuntimeProgramTargetInput,
): RuntimeProgramTargetDeclaration {
  if ("target" in input && "definition" in input) {
    validateTargetDefinition(input.definition);
    return Object.freeze({
      target: input.target,
      definition: Object.freeze({ ...input.definition }),
    });
  }
  const id = runtimeHandlerTargetIdentity(input);
  return Object.freeze({
    target: input,
    definition: Object.freeze({
      id,
      fingerprint: sha256Hex(
        encoder.encode(
          JSON.stringify({
            format: "crux-runtime-target:v1",
            id,
            kind: targetManifestEntry(input).kind,
          }),
        ),
      ),
    }),
  });
}

function validateTargetDefinition(
  definition: RuntimeProgramTargetDefinitionInput,
): void {
  if (
    typeof definition.fingerprint === "string" &&
    definition.fingerprint.trim().length > 0
  ) {
    return;
  }
  throw createRuntimeError({
    code: "RUNTIME_ARTIFACT_MANIFEST_INVALID",
    whatFailed: "Runtime target definition fingerprint is missing.",
    why: "Durable target selection requires an exact definition fingerprint.",
    whatStillWorks: "Targets with complete definition metadata remain valid.",
    nextStep: "Provide the generated definition fingerprint for this target.",
  });
}

function canonicalTargetDefinitions(
  targets: readonly RuntimeProgramTarget[],
  declarations: readonly RuntimeProgramTargetDeclaration[],
): readonly RuntimeProgramTargetDefinition[] {
  const byTarget = new Map(
    declarations.map((declaration) => [
      runtimeHandlerTargetIdentity(declaration.target),
      declaration.definition,
    ]),
  );
  return Object.freeze(
    targets.map((target) => {
      const targetId = runtimeHandlerTargetIdentity(target);
      const definition = byTarget.get(targetId)!;
      return Object.freeze({
        targetId: targetId as RuntimeTargetDefinitionRef["targetId"],
        definitionId: definition.id,
        fingerprint: definition.fingerprint,
      });
    }),
  );
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
  targets: readonly RuntimeProgramTarget[],
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

function targetManifestEntry(target: RuntimeProgramTarget): {
  readonly id: string;
  readonly kind: "flow" | "task" | "agent";
} {
  return {
    id: runtimeHandlerTargetIdentity(target),
    kind: isAgent(target) ? "agent" : target.kind,
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
