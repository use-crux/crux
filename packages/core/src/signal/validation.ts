/**
 * Signal schema execution and normalized JSON-safety validation.
 *
 * @module
 */

import { SignalError, SignalValidationError } from "./errors";
import { cloneSignalJson, freezeSignalJson } from "./canonical-json";
import type { StandardSchemaV1 } from "../internal/standard-schema";
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
  let result: StandardSchemaV1.Result<InferSignalSchemaOutput<TSchema>>;
  try {
    result = await schema["~standard"].validate(payload);
  } catch {
    return publicationRejected(signalId);
  }

  let inspected:
    | {
        readonly success: true;
        readonly value: InferSignalSchemaOutput<TSchema>;
      }
    | {
        readonly success: false;
        readonly issues: readonly StandardSchemaV1.Issue[];
      };
  try {
    const issues = result.issues;
    inspected =
      issues === undefined
        ? { success: true, value: result.value }
        : { success: false, issues };
  } catch {
    return publicationRejected(signalId);
  }
  if (!inspected.success) {
    let validationError: SignalValidationError;
    try {
      validationError = new SignalValidationError(inspected.issues);
    } catch {
      return publicationRejected(signalId);
    }
    throw validationError;
  }
  return freezeSignalJson(
    cloneSignalJson(inspected.value, "normalized output"),
  );
}

function publicationRejected(signalId: string): never {
  throw new SignalError(
    "publication_rejected",
    `Signal \`${signalId}\` schema validation could not complete.`,
  );
}
