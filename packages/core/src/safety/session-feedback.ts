import type { ConstraintFailure } from "./constraint/types";
import type { ConstraintFeedbackFormatter } from "./session-contract";

/**
 * Stock corrective-message wording used by constraint regeneration.
 *
 * Applications can replace this through `SafetyCallOptions.formatter` for
 * localization or structured feedback without changing session execution.
 */
export const defaultConstraintFeedbackFormatter: ConstraintFeedbackFormatter = {
  format(failures: readonly ConstraintFailure[]): string {
    const combined = failures
      .map((failure) =>
        failure.feedback ? `[${failure.name}]: ${failure.feedback}` : "",
      )
      .filter(Boolean)
      .join("\n");
    return [
      "Your previous output did not satisfy the following quality constraints. Please fix all issues in your next response.",
      "",
      combined,
    ].join("\n");
  },
};
