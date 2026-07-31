/**
 * Signal schema execution and normalized JSON-safety validation.
 *
 * @module
 */

import { SignalError, SignalValidationError } from "./errors";
import { cloneSignalJson, freezeSignalJson } from "./canonical-json";
import type {
  InferSignalSchemaInput,
  InferSignalSchemaOutput,
  SignalSchema,
} from "./schema-types";

/** Validate, normalize, and detach one authored Signal payload. @internal */
export async function validateSignalPayload<
  TId extends string,
  TSchema extends SignalSchema,
>(
  signalId: TId,
  schema: TSchema,
  payload: InferSignalSchemaInput<TSchema>,
): Promise<InferSignalSchemaOutput<TSchema>> {
  let result;
  try {
    result = await schema["~standard"].validate(payload);
  } catch {
    throw new SignalError(
      "publication_rejected",
      `Signal \`${signalId}\` schema validation could not complete.`,
    );
  }
  if (result.issues !== undefined) {
    throw new SignalValidationError(result.issues);
  }
  return freezeSignalJson(
    cloneSignalJson(result.value, "normalized output"),
  );
}
