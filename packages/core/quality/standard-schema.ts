/**
 * Standard Schema v1 interface (https://standardschema.dev).
 *
 * Vendored type-only copy of the community spec so `dataset()` and
 * `ctx.step(name, schema)` accept any conforming validation library —
 * zod (Crux's native schema language), valibot, and arktype all implement
 * `~standard`. No runtime dependency is needed: the spec is purely structural.
 *
 * @module
 */

/**
 * A schema conforming to the Standard Schema v1 spec.
 *
 * Any zod 4 / valibot / arktype schema satisfies this interface structurally.
 * Quality APIs use it where source types do not exist (file datasets, flow
 * step outputs) so one annotation buys static types plus runtime validation.
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 * import { dataset } from '@use-crux/core/quality'
 *
 * // z.object(...) is a StandardSchemaV1 — no adapter needed.
 * const rows = dataset('golden/support.jsonl', {
 *   input: z.object({ question: z.string() }),
 * })
 * ```
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema vendor envelope. */
  readonly '~standard': StandardSchemaV1.Props<Input, Output>
}

export declare namespace StandardSchemaV1 {
  /** The `~standard` envelope: version, vendor, validate, and phantom types. */
  export interface Props<Input = unknown, Output = Input> {
    /** Spec version. Always `1`. */
    readonly version: 1
    /** Implementing library, e.g. `"zod"`. */
    readonly vendor: string
    /** Validate a value; returns the typed output or issues. */
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>
    /** Inference-only phantom carrying the input/output types. */
    readonly types?: Types<Input, Output> | undefined
  }

  /** Validation result: success with the typed value, or failure with issues. */
  export type Result<Output> = SuccessResult<Output> | FailureResult

  /** Successful validation. */
  export interface SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
  }

  /** Failed validation. */
  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
  }

  /** One validation issue. */
  export interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined
  }

  /** An object path segment. */
  export interface PathSegment {
    readonly key: PropertyKey
  }

  /** Phantom type carrier. */
  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input
    readonly output: Output
  }

  /** Extract the input type of a Standard Schema. */
  export type InferInput<S extends StandardSchemaV1> = NonNullable<S['~standard']['types']>['input']

  /** Extract the output type of a Standard Schema. */
  export type InferOutput<S extends StandardSchemaV1> = NonNullable<S['~standard']['types']>['output']
}
