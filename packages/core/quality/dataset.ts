/**
 * Schema-validated file datasets (golden sets).
 *
 * File-loaded cases cannot be statically inferred, so `dataset()` requires a
 * schema and returns typed rows: static types from the schema, runtime
 * validation at load time. Any Standard Schema library works — zod (Crux's
 * native schema language), valibot, arktype.
 *
 * @module
 */

import type { StandardSchemaV1 } from './standard-schema'

/**
 * Internal storage key for a dataset's runtime definition (schemas for the
 * load-time validation the runner performs). @internal
 */
export const DATASET_INTERNAL: unique symbol = Symbol('crux.quality.dataset')

/** Runtime definition carried by every dataset. @internal */
export interface DatasetInternal {
  readonly input: StandardSchemaV1
  readonly expected?: StandardSchemaV1
}

/**
 * A typed reference to a file-backed golden set. Rows are resolved lazily by
 * the runner at execute time; schema validation failure is a definition error
 * (exit code 2), not a case failure.
 *
 * Dataset rows are pure data — `input`, optional `expected`, and the
 * data-only case options (`name`, `tags`, `trials`, `skip`, `only`). Rows
 * cannot carry `expect` callbacks; case-specific logic belongs in inline
 * cases or the evaluation-level `expect`.
 *
 * @typeParam TInput    - Row input type, inferred from the input schema.
 * @typeParam TExpected - Row expected type, inferred from the expected schema.
 */
export interface Dataset<TInput, TExpected = never> {
  /** Discriminant tag for runtime detection in `data:` arrays. */
  readonly _tag: 'CruxDataset'
  /** The file path as authored (resolved against the quality root). */
  readonly path: string
  /** @internal Inference-only phantom carrying the row types. */
  readonly __cruxQualityDataset?: {
    input: TInput
    expected: TExpected
  }
  /** @internal Load-time validation schemas; read by the runner. */
  readonly [DATASET_INTERNAL]: DatasetInternal
}

/**
 * Declare a schema-validated file dataset (JSON | JSONL | CSV by extension).
 *
 * The schema is the one annotation the serialization boundary requires: rows
 * get static types from it and are validated against it when the runner first
 * loads the file. Mixing is allowed — `data: […inlineCases, goldenSet]`
 * concatenates inline cases with dataset rows.
 *
 * @param path - File path, resolved against the quality root.
 * @param opts - `input` schema (required) and optional `expected` schema.
 * @returns A typed {@link Dataset} reference; rows load lazily at run time.
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 * import { evaluate, dataset } from '@crux/core/quality'
 *
 * const goldenSet = dataset('golden/support.jsonl', {
 *   input: z.object({ question: z.string(), locale: z.enum(['en', 'nl']) }),
 *   expected: z.object({ answer: z.string() }),
 * })
 *
 * export default evaluate({
 *   task: supportPrompt,
 *   data: goldenSet, // ctx.expected: { answer: string } | undefined
 * })
 * ```
 */
export function dataset<SI extends StandardSchemaV1, SE extends StandardSchemaV1 = never>(
  path: string,
  opts: { input: SI; expected?: SE },
): Dataset<StandardSchemaV1.InferOutput<SI>, StandardSchemaV1.InferOutput<SE>> {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new TypeError('dataset(): `path` must be a non-empty string.')
  }
  if (opts?.input?.['~standard'] === undefined) {
    throw new TypeError('dataset(): `input` must be a Standard Schema (zod, valibot, arktype, …).')
  }
  return Object.freeze({
    _tag: 'CruxDataset' as const,
    path,
    [DATASET_INTERNAL]: Object.freeze({ input: opts.input, expected: opts.expected }),
  })
}
