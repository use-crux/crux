/**
 * Private immutable definition carried by every inert Eval.
 *
 * @internal
 * @module
 */

import type { StandardSchemaV1 } from "../../quality/standard-schema";
import type { JsonValue } from "../../storage";
import type { EvalCoverageTargetId } from "../evaluate";
import type { AnyEval } from "../evaluate";

/** Private storage key for an Eval's normalized definition. */
export const EVAL_INTERNAL: unique symbol = Symbol("crux.eval.definition");

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

/** Portable Phase 1 authoring manifest. */
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
  readonly trials: number;
  readonly tags: readonly string[];
  readonly description?: string;
  readonly covers: readonly EvalCoverageTargetId[];
}

/** Read an Eval definition for internal coordinator and repository tests. */
export function getEvalDefinitionForInternalUse(
  evalValue: AnyEval,
): EvalDefinitionV1 {
  const definition = (
    evalValue as unknown as Record<
      typeof EVAL_INTERNAL,
      EvalDefinitionV1 | undefined
    >
  )[EVAL_INTERNAL];
  if (definition === undefined) {
    throw new TypeError("Expected a Crux Eval (missing internal definition).");
  }
  return definition;
}
