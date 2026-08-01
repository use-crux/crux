/**
 * Define typed callable custom effects.
 *
 * @module
 */

import type {
  CapturedRecoverableEffectOptions,
  EffectDefinition,
  EffectExecutor,
  EffectOptions,
  RecoverableEffectDefinition,
  RecoverableEffectOptions,
} from "./types";
import { CruxEffectError } from "./errors";
import {
  executeEffectOccurrence,
  type EffectRuntimeOptions,
} from "./internal/execution";
import { trackEffectBoundaryOperation } from "./internal/boundary";
import { recoverEffectReceiptForDefinition } from "./recover";

interface RegistryDefinition {
  readonly id: string;
  readonly version: number;
}

const definitionsByIdentity = new Map<string, object>();

/**
 * Define a recoverable effect whose handler receives captured pre-state.
 *
 * @param id - Stable dotted domain identifier.
 * @param execute - Function that performs the external state change.
 * @param options - Resource and captured-recovery configuration.
 * @returns A typed callable recoverable effect definition.
 */
export function effect<TOutput, TCaptured, TInput = void>(
  id: string,
  execute: EffectExecutor<TInput, TOutput>,
  options: CapturedRecoverableEffectOptions<
    TInput,
    TOutput,
    TCaptured
  >,
): RecoverableEffectDefinition<TInput, TOutput>;

/**
 * Define a recoverable effect whose handler receives input and output.
 *
 * @param id - Stable dotted domain identifier.
 * @param execute - Function that performs the external state change.
 * @param options - Resource and recovery configuration.
 * @returns A typed callable recoverable effect definition.
 */
export function effect<TOutput, TInput = void>(
  id: string,
  execute: EffectExecutor<TInput, TOutput>,
  options: RecoverableEffectOptions<TInput, TOutput>,
): RecoverableEffectDefinition<TInput, TOutput>;

/**
 * Define a callable custom effect.
 *
 * @param id - Stable dotted domain identifier.
 * @param execute - Function that performs the external state change.
 * @param options - Optional version and resource configuration.
 * @returns A typed callable effect definition.
 *
 * @example
 * ```ts
 * const sendEmail = effect(
 *   "email.send",
 *   async (input: { to: string }) => email.send(input),
 * )
 *
 * await sendEmail({ to: "person@example.com" })
 * ```
 */
export function effect<TOutput, TInput = void>(
  id: string,
  execute: EffectExecutor<TInput, TOutput>,
  options?: EffectOptions<TInput>,
): EffectDefinition<TInput, TOutput>;

export function effect(
  id: string,
  execute: unknown,
  options?: unknown,
): EffectDefinition<unknown, unknown> {
  const typedExecutor = execute as EffectExecutor<unknown, unknown>;
  const typedOptions = options as
    | EffectRuntimeOptions<unknown, unknown>
    | undefined;
  const version = typedOptions?.version ?? 1;
  const recoverable = isRecoverableOptions(options);

  const run = (
    ...args: [input: unknown] | []
  ): Promise<{
    readonly output: unknown;
    readonly receipt: {
      readonly kind: "effect.receipt";
      readonly id: string;
      readonly effectId: string;
    };
  }> =>
    trackEffectBoundaryOperation(
      executeEffectOccurrence(
        { id, version },
        typedExecutor,
        args,
        typedOptions,
      ),
    );

  const definition = async (...args: [input: unknown] | []) =>
    (await run(...args)).output;
  Object.defineProperties(definition, {
    id: { value: id, enumerable: true },
    version: { value: version, enumerable: true },
    _tag: { value: "EffectDefinition", enumerable: true },
    run: { value: run, enumerable: true },
    ...(recoverable
      ? {
          recover: {
            value: (
              receipt: Parameters<
                typeof recoverEffectReceiptForDefinition
              >[1],
              recoverOptions?: Parameters<
                typeof recoverEffectReceiptForDefinition
              >[2],
            ) =>
              recoverEffectReceiptForDefinition(
                id,
                receipt,
                recoverOptions,
              ),
            enumerable: true,
          },
        }
      : {}),
  });
  const frozen = Object.freeze(
    definition,
  ) as EffectDefinition<unknown, unknown>;
  return registerEffectDefinition(frozen);
}

function isRecoverableOptions(
  options: unknown,
): options is { readonly recover: unknown } {
  return (
    typeof options === "object" &&
    options !== null &&
    "recover" in options
  );
}

function definitionKey(definition: RegistryDefinition): string {
  return `${definition.id}\u0000${definition.version}`;
}

function registerEffectDefinition<
  TDefinition extends RegistryDefinition & object,
>(definition: TDefinition): TDefinition {
  const key = definitionKey(definition);
  const existing = definitionsByIdentity.get(key);
  if (existing === definition) return definition;
  if (existing) {
    throw new CruxEffectError({
      code: "EFFECT_DUPLICATE_ID",
      message:
        `Effect \`${definition.id}\` version ${definition.version} ` +
        "is already defined by a different object.",
    });
  }
  definitionsByIdentity.set(key, definition);
  return definition;
}

/** Re-register one definition object to verify identical re-export collapse. */
export function registerEffectDefinitionForTesting<
  TDefinition extends RegistryDefinition & object,
>(definition: TDefinition): TDefinition {
  return registerEffectDefinition(definition);
}

/** Clear the effect-definition registry between tests. */
export function resetEffectDefinitionsForTesting(): void {
  definitionsByIdentity.clear();
}
