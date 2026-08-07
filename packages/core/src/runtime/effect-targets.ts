/**
 * Immutable Effect recovery-target declarations for Runtime programs.
 *
 * @module
 */

import type { RecoverableEffectDefinition } from "../effect/types";
import {
  isRuntimeAddressableEffectDefinition,
  type RuntimeAddressableEffectDefinition,
} from "../effect/internal/recovery-definition";
import { createRuntimeError } from "./engine/errors";

/** Recoverable Effect definition accepted by a Runtime program. */
export type RuntimeEffectTargetDefinition = RecoverableEffectDefinition<
  never,
  unknown
>;

/** Serializable identity of one Runtime-addressable Effect recovery target. */
export interface RuntimeEffectTarget {
  /** Stable authored Effect identifier. */
  readonly id: string;
  /** Exact recovery and replay contract version. */
  readonly version: number;
}

type RuntimeEffectTargetTable = Readonly<
  Record<string, RuntimeAddressableEffectDefinition>
>;

/** Program-owned table of authored definitions, hidden from manifest identity. */
export const runtimeEffectTargetTable = "__cruxRuntimeEffectTargetTable" as const;

/** Internal Runtime program capability for exact Effect target resolution. */
export interface RuntimeEffectTargetProgram {
  readonly [runtimeEffectTargetTable]: RuntimeEffectTargetTable;
}

/** Canonical declarations and their immutable program-owned definition table. */
export interface BoundRuntimeEffectTargets {
  readonly targets: readonly RuntimeEffectTarget[];
  readonly table: RuntimeEffectTargetTable;
}

/** Project recoverable definitions to canonical immutable target identities. */
export function canonicalizeRuntimeEffectTargets(
  definitions: readonly RuntimeEffectTargetDefinition[],
): readonly RuntimeEffectTarget[] {
  return bindRuntimeEffectTargets(definitions).targets;
}

/** Bind exact authored definitions into one immutable Runtime program table. */
export function bindRuntimeEffectTargets(
  definitions: readonly RuntimeEffectTargetDefinition[],
): BoundRuntimeEffectTargets {
  const entries = definitions.map((definition) => {
    if (!isRuntimeAddressableEffectDefinition(definition)) {
      invalidEffectTarget(definition);
    }
    return {
      definition,
      target: Object.freeze({
        id: definition.id,
        version: definition.version,
      }),
    };
  }).sort((left, right) => compareTargets(left.target, right.target));
  const unique: Array<(typeof entries)[number]> = [];
  for (const entry of entries) {
    const previous = unique.at(-1);
    if (
      previous?.target.id === entry.target.id &&
      previous.target.version === entry.target.version
    ) {
      if (previous.definition === entry.definition) continue;
      duplicateEffectTarget(entry.target);
    }
    unique.push(entry);
  }
  const table: Record<string, RuntimeAddressableEffectDefinition> =
    Object.create(null) as Record<
      string,
      RuntimeAddressableEffectDefinition
    >;
  for (const entry of unique) {
    table[effectTargetKey(entry.target.id, entry.target.version)] =
      entry.definition;
  }
  return Object.freeze({
    targets: Object.freeze(unique.map((entry) => entry.target)),
    table: Object.freeze(table),
  });
}

/** Resolve an exact Effect definition from its owning Runtime program. */
export function resolveRuntimeEffectTarget(
  program: object | undefined,
  id: string,
  version: number,
): RuntimeAddressableEffectDefinition | undefined {
  const targetProgram = program as
    | Partial<RuntimeEffectTargetProgram>
    | undefined;
  return targetProgram?.[runtimeEffectTargetTable]?.[
    effectTargetKey(id, version)
  ];
}

function duplicateEffectTarget(target: RuntimeEffectTarget): never {
  throw createRuntimeError({
    code: "TARGET_DUPLICATE",
    whatFailed:
      `Effect recovery target \`${target.id}\` version ${target.version} ` +
      "is declared more than once.",
    why: "A Runtime program needs one definition for each exact Effect recovery identity.",
    whatStillWorks:
      "Other uniquely identified Runtime and Effect targets remain valid.",
    nextStep:
      `Remove the duplicate \`${target.id}\` version ${target.version} declaration.`,
  });
}

function invalidEffectTarget(target: RuntimeEffectTargetDefinition): never {
  throw createRuntimeError({
    code: "TARGET_NOT_FOUND",
    whatFailed: "A Runtime Effect recovery target is not recoverable.",
    why:
      "Runtime programs can address only definitions created by effect() with a recovery handler.",
    whatStillWorks:
      "The Effect can still execute outside durable Runtime-backed scopes.",
    nextStep:
      `Define recovery for \`${target.id}\` before adding it to effectTargets.`,
  });
}

function effectTargetKey(id: string, version: number): string {
  return `${id}\u0000${version}`;
}

function compareTargets(
  left: RuntimeEffectTarget,
  right: RuntimeEffectTarget,
): number {
  return left.id === right.id
    ? left.version - right.version
    : left.id < right.id
      ? -1
      : 1;
}
