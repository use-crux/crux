/**
 * Shared structural types for Standard Schema v1 validation.
 *
 * This internal module lets Core domains accept any conforming schema without
 * adding a runtime dependency or a public schema subpath.
 *
 * @module
 */

/** A schema conforming to the Standard Schema v1 specification. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema vendor envelope. */
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  /** The `~standard` envelope carried by a conforming schema. */
  export interface Props<Input = unknown, Output = Input> {
    /** Specification version. */
    readonly version: 1;
    /** Implementing schema vendor. */
    readonly vendor: string;
    /** Validate an authored value and return normalized output or issues. */
    readonly validate: (
      value: unknown,
    ) => Result<Output> | Promise<Result<Output>>;
    /** Inference-only input and output carrier. */
    readonly types?: Types<Input, Output> | undefined;
  }

  /** Validation result from a conforming schema. */
  export type Result<Output> = SuccessResult<Output> | FailureResult;

  /** Successful validation with normalized output. */
  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  /** Failed validation with one or more issues. */
  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  /** One validation issue. */
  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  /** One object path segment. */
  export interface PathSegment {
    readonly key: PropertyKey;
  }

  /** Inference-only authored input and normalized output carrier. */
  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  /** Extract the authored input accepted by a Standard Schema. */
  export type InferInput<S extends StandardSchemaV1> = NonNullable<
    S["~standard"]["types"]
  >["input"];

  /** Extract the normalized output produced by a Standard Schema. */
  export type InferOutput<S extends StandardSchemaV1> = NonNullable<
    S["~standard"]["types"]
  >["output"];
}
