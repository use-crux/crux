/**
 * Schema-carrying references to file-backed Eval Cases.
 *
 * Core validates only the carrier itself. Reading JSON, JSONL, or CSV belongs
 * to the Node discovery layer, so importing this module remains Workers-safe.
 *
 * @module
 */

import type { StandardSchemaV1 } from "../quality/standard-schema";
import type { CaseFileRef } from "./internal/definition";

const CASE_FILE_INTERNAL: unique symbol = Symbol("crux.eval.case-file");

/**
 * An inert reference to schema-validated Cases stored in a file.
 *
 * @typeParam I - Validated Case input.
 * @typeParam E - Validated expected evidence, when a schema is supplied.
 */
export interface CaseFile<I, E = never> {
  readonly _tag: "CruxCaseFile";
  readonly path: string;
  readonly __types?: {
    readonly input: () => I;
    readonly expected: () => E;
  };
  readonly [CASE_FILE_INTERNAL]: CaseFileRef;
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (value === null || typeof value !== "object" || !("~standard" in value))
    return false;
  const standard = value["~standard"];
  return (
    standard !== null &&
    typeof standard === "object" &&
    "version" in standard &&
    standard.version === 1 &&
    "vendor" in standard &&
    typeof standard.vendor === "string" &&
    "validate" in standard &&
    typeof standard.validate === "function"
  );
}

/** Return whether a value is a Crux case-file carrier. @internal */
export function isCaseFile(
  value: unknown,
): value is CaseFile<unknown, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    "_tag" in value &&
    value._tag === "CruxCaseFile"
  );
}

/** Read the normalized case-file reference carried by a public wrapper. @internal */
export function getCaseFileRef(value: CaseFile<unknown, unknown>): CaseFileRef {
  const reference = value[CASE_FILE_INTERNAL];
  if (reference === undefined) {
    throw new TypeError(
      "Expected a Crux case-file reference (missing internal definition).",
    );
  }
  return reference;
}

/**
 * Declare Cases stored in a JSON, JSONL, or CSV file.
 *
 * @param path - Authored path, resolved later by Node discovery.
 * @param schemas - Required input schema and optional expected schema.
 * @returns A frozen inert carrier; no filesystem work is performed.
 */
export function caseFile<
  SI extends StandardSchemaV1,
  SE extends StandardSchemaV1 = never,
>(
  path: string,
  schemas: { readonly input: SI; readonly expected?: SE },
): CaseFile<
  StandardSchemaV1.InferOutput<SI>,
  StandardSchemaV1.InferOutput<SE>
> {
  if (typeof path !== "string" || path.trim() === "") {
    throw new TypeError("caseFile(): `path` must be a non-empty string.");
  }
  if (!isStandardSchema(schemas?.input)) {
    throw new TypeError("caseFile(): `input` must be a Standard Schema.");
  }
  if (schemas.expected !== undefined && !isStandardSchema(schemas.expected)) {
    throw new TypeError(
      "caseFile(): `expected` must be a Standard Schema when provided.",
    );
  }

  const reference: CaseFileRef = Object.freeze({
    _tag: "CruxCaseFile",
    path,
    inputSchema: schemas.input,
    ...(schemas.expected !== undefined
      ? { expectedSchema: schemas.expected }
      : {}),
  });
  const carrier = {
    _tag: "CruxCaseFile" as const,
    path,
  };
  Object.defineProperty(carrier, CASE_FILE_INTERNAL, {
    value: reference,
    enumerable: false,
  });
  return Object.freeze(carrier) as CaseFile<
    StandardSchemaV1.InferOutput<SI>,
    StandardSchemaV1.InferOutput<SE>
  >;
}
