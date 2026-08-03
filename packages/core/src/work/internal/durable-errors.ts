/** Canonical diagnostics shared by durable Work read-model operations. */

import { createRuntimeError } from "../../runtime/engine/errors";

/** Report that a Work control record is absent from its Runtime namespace. */
export function retainedWorkMissing(id: string): Error {
  return createRuntimeError({
    code: "TARGET_NOT_FOUND",
    whatFailed: `Work \`${id}\` is no longer retained.`,
    why: "Its Runtime control record is absent from the configured namespace.",
    whatStillWorks: "Other retained Work occurrences remain readable.",
    nextStep: "Check the retention policy before reconnecting this Work.",
  });
}
