import type { CompletedOperationResult } from "../../completed-operation/contracts";

/** Completed operation names covered by the shared adapter test law. */
export type CompletedMediaOperationName = "image" | "transcription" | "speech";

/** One fixture-driven completed-operation tracer case. */
export interface CompletedMediaConformanceCase<
  TResult extends CompletedOperationResult,
> {
  readonly operation: CompletedMediaOperationName;
  readonly run: () => Promise<TResult>;
}

/** A failed invariant from the provider-neutral completed-operation tracer. */
export interface CompletedMediaConformanceViolation {
  readonly operation: CompletedMediaOperationName;
  readonly message: string;
}

/**
 * Exercise image, transcription, and speech through one result-tail law.
 *
 * This test-only harness performs no provider discovery. Adapter suites pass
 * explicit fixtures so omission remains a structural property of the runtime.
 */
export async function completedMediaConformance(
  cases: readonly CompletedMediaConformanceCase<CompletedOperationResult>[],
): Promise<readonly CompletedMediaConformanceViolation[]> {
  const violations: CompletedMediaConformanceViolation[] = [];
  for (const fixture of cases) {
    const result = await fixture.run();
    if (!Array.isArray(result.warnings)) {
      violations.push({
        operation: fixture.operation,
        message: "warnings must always be an array",
      });
    }
    if (
      !Number.isSafeInteger(result.execution.calls) ||
      result.execution.calls < 1
    ) {
      violations.push({
        operation: fixture.operation,
        message: "execution must retain positive call facts",
      });
    }
    if (!("raw" in result)) {
      violations.push({
        operation: fixture.operation,
        message: "raw provider output must be retained",
      });
    }
  }
  return Object.freeze(violations.map((violation) => Object.freeze(violation)));
}
