/**
 * Global internal immutable definition carried by every inert Eval.
 *
 * @internal
 * @module
 */

import type { StandardSchemaV1 } from "../../internal/standard-schema";
import type { JsonValue } from "../../storage";
import type { EvalCoverageTargetId } from "../evaluate";
import type { AnyEval } from "../evaluate";
import type { NormalizedEvalTimeoutPolicy } from "../timeout-policy";

const LEGACY_EVAL_INTERNAL_DESCRIPTION = "crux.eval.definition";

/** Global internal storage key for an Eval's normalized definition. */
export const EVAL_INTERNAL: unique symbol = Symbol.for(
  "@use-crux/core/eval/internal-definition",
);

/** Frozen callback declaration consumed by planning without invocation. */
export interface NormalizedEvalCheck {
  readonly check: (context: never) => void | Promise<void>;
  readonly requiresFresh: boolean;
}

/** One inline Case erased to its runtime authoring shape. */
export interface RawEvalCase {
  readonly id?: string;
  readonly name?: string;
  readonly input: unknown;
  readonly call?: unknown;
  readonly expected?: unknown;
  /** Diagnostic marker for file evidence accepted without an expected schema. */
  readonly unvalidatedExpected?: true;
  readonly expect?: NormalizedEvalCheck;
  readonly afterScores?: NormalizedEvalCheck;
  readonly timeout?: NormalizedEvalTimeoutPolicy | null;
  readonly trials?: number;
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly only?: boolean;
  readonly skip?: boolean | string;
}

/** Position of one authored Case source before collection expands files. */
export interface EvalCaseSourcePosition {
  readonly kind: "inline" | "file";
  readonly index: number;
}

/** One inert case-file reference in the normalized definition. */
export interface CaseFileRef {
  readonly _tag: "CruxCaseFile";
  readonly path: string;
  readonly inputSchema: StandardSchemaV1;
  readonly expectedSchema?: StandardSchemaV1;
}

/** One declared comparison arm. Current is always the first arm. */
export interface EvalArmDeclaration {
  readonly name: string;
  readonly overrideKeys: readonly string[];
}

/** Portable authoring manifest consumed by Eval coordinators. */
export interface EvalDefinitionV1 {
  readonly schemaVersion: 1;
  readonly explicitId?: string;
  readonly task: unknown;
  readonly cases: readonly RawEvalCase[];
  readonly caseFiles: readonly CaseFileRef[];
  /** Stable mixed-source order retained while inline/file collections stay separate. */
  readonly caseSourceOrder: readonly EvalCaseSourcePosition[];
  readonly variants: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  readonly arms: readonly EvalArmDeclaration[];
  readonly expect?: NormalizedEvalCheck;
  readonly afterScores?: NormalizedEvalCheck;
  readonly scorers: unknown;
  readonly gates?: Readonly<Record<string, unknown>>;
  readonly timeout?: NormalizedEvalTimeoutPolicy | null;
  readonly trials: number;
  readonly tags: readonly string[];
  readonly description?: string;
  readonly covers: readonly EvalCoverageTargetId[];
}

/** Read an Eval definition for internal coordinator and repository tests. */
export function getEvalDefinitionForInternalUse(
  evalValue: AnyEval,
): EvalDefinitionV1 {
  if (!isEvalShell(evalValue)) {
    throw new TypeError("Expected a Crux Eval (missing internal definition).");
  }
  const definition =
    (
      evalValue as unknown as Record<
        typeof EVAL_INTERNAL,
        EvalDefinitionV1 | undefined
      >
    )[EVAL_INTERNAL] ?? getLegacyEvalDefinitionForInternalUse(evalValue);
  if (!isEvalDefinitionV1(definition)) {
    throw new TypeError("Expected a Crux Eval (missing internal definition).");
  }
  return definition;
}

/** Return whether a value is an Eval authored by a compatible Core contract. */
export function isEvalForInternalUse(value: unknown): value is AnyEval {
  try {
    getEvalDefinitionForInternalUse(value as AnyEval);
    return true;
  } catch {
    return false;
  }
}

function getLegacyEvalDefinitionForInternalUse(
  evalValue: AnyEval,
): EvalDefinitionV1 | undefined {
  for (const key of Object.getOwnPropertySymbols(evalValue)) {
    if (key.description !== LEGACY_EVAL_INTERNAL_DESCRIPTION) {
      continue;
    }
    const candidate = (evalValue as unknown as Record<symbol, unknown>)[key];
    if (isEvalDefinitionV1(candidate)) return candidate;
  }
  return undefined;
}

function isEvalShell(
  value: unknown,
): value is object & { readonly _tag: "CruxEval" } {
  return (
    value !== null &&
    typeof value === "object" &&
    "_tag" in value &&
    value._tag === "CruxEval"
  );
}

function isEvalDefinitionV1(value: unknown): value is EvalDefinitionV1 {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    candidate.schemaVersion === 1 &&
    "task" in candidate &&
    Array.isArray(candidate.cases) &&
    Array.isArray(candidate.caseFiles) &&
    Array.isArray(candidate.caseSourceOrder) &&
    isObjectRecord(candidate.variants) &&
    Array.isArray(candidate.arms) &&
    "scorers" in candidate &&
    typeof candidate.trials === "number" &&
    Array.isArray(candidate.tags) &&
    Array.isArray(candidate.covers)
  );
}

function isObjectRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
