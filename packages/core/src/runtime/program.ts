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
import type { RuntimeTargetDefinitionRef } from "./ports/target-definition";
import { isAgent, type AnyAgent } from "../agent";
import type { GenerationModel } from "../generation-model";
import type { SignalProvider } from "../signal/provider";
import {
  canonicalizeProgramGenerationModels,
  generationModelManifestEntry,
  targetGenerationModelReference,
} from "./program-generation-models";
import {
  canonicalizeProgramProviders,
  providerManifestEntry,
  validateProgramProviderBindings,
} from "./program-providers";
import { canonicalizeProgramTransports } from "./program-transports";

const encoder = new TextEncoder();

/** Executable Runtime target declaration with an explicit durable kind. */
export type RuntimeProgramTarget =
  | AnyAgent
  | (Exclude<RuntimeHandlerTarget, AnyAgent> & {
      readonly kind: "flow" | "task" | "agent";
    });

/**
 * Immutable executable target, definition, generation-model, provider, and
 * transport truth for one project.
 *
 * @remarks Shallow-frozen and free of live clients, credentials, or registration
 * in its inert declarations. Executable Signal providers are process authority
 * analogous to named targets: they retain `onEvent` for normalization but never
 * enter `RuntimeManagedTransportBinding` projections or secret-bearing hash
 * fields. Durable Agent Sessions may select models only from `generationModels`.
 */
export interface RuntimeProgram {
  /** SHA-256 of the canonical program declaration. */
  readonly manifestHash: string;
  /** Canonically ordered executable Runtime target declarations. */
  readonly targets: readonly RuntimeProgramTarget[];
  /** Generated definition identity for each executable target. */
  readonly targetDefinitions: readonly RuntimeProgramTargetDefinition[];
  /** Canonically ordered, statically declared generation models. */
  readonly generationModels: readonly GenerationModel[];
  /**
   * Explicitly imported executable Signal providers for managed-transport drain.
   *
   * @remarks Live process authority only. Manifest hashing retains provider ids,
   * never callbacks, credentials, Requests, or clients.
   */
  readonly providers: readonly SignalProvider[];
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
  /**
   * Explicitly imported executable Signal providers for transport normalization.
   *
   * @remarks Required for every managed-transport binding. Providers are live
   * process authority and are never serialized into inert bindings.
   */
  readonly providers?: readonly SignalProvider[];
  /** Inert provider-neutral managed-transport bindings. */
  readonly transports: readonly RuntimeManagedTransportBinding[];
}

/**
 * Validate and canonicalize one immutable Runtime program.
 *
 * Generated artifacts and hand-written hosts use this same pure construction
 * path. It performs no registration, discovery, configuration lookup, or I/O.
 *
 * @param options.targets - Statically imported Flow, task, and Agent targets.
 * @param options.generationModels - Models durable Agent Sessions may select.
 * @param options.providers - Executable Signal providers for managed transports.
 * @param options.transports - Inert managed-transport bindings.
 * @returns A frozen program whose `manifestHash` covers targets, models,
 *   provider ids, and transports.
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
  const providers = canonicalizeProgramProviders(options.providers ?? []);
  // Signal transport targets name Signal definition ids, not Agent/Flow/task
  // Runtime targets. Binding well-formedness is enforced by the managed
  // transport validator; do not require a matching executable target.
  const transports = canonicalizeProgramTransports(options.transports);
  validateProgramProviderBindings(providers, transports);

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
        providers: providers.map(providerManifestEntry),
        transports,
      }),
    ),
  );
  return Object.freeze({
    manifestHash,
    targets,
    targetDefinitions,
    generationModels,
    providers,
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

function targetManifestEntry(target: RuntimeProgramTarget): {
  readonly id: string;
  readonly kind: "flow" | "task" | "agent";
} {
  return {
    id: runtimeHandlerTargetIdentity(target),
    kind: isAgent(target) ? "agent" : target.kind,
  };
}
