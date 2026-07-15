import {
  observabilityDiagnostics,
  observe,
  type ObservabilityFlushResult,
} from "@use-crux/core/observability";

const DEFAULT_NEXT_FLUSH_TIMEOUT_MS = 5_000;

/** Private options for the Next-owned terminal observability drain. */
export interface NextObservabilityDrainOptions {
  readonly flushTimeoutMs?: number;
  readonly onDrain?: (result: ObservabilityFlushResult) => void;
}

/** Run the contained, bounded terminal observability drain for one invocation. */
export async function reportNextObservabilityDrain(
  options: NextObservabilityDrainOptions,
): Promise<void> {
  let result: ObservabilityFlushResult;
  try {
    result = await observe.flush({
      timeoutMs: options.flushTimeoutMs ?? DEFAULT_NEXT_FLUSH_TIMEOUT_MS,
    });
  } catch (error) {
    const diagnostics = observabilityDiagnostics();
    console.error(
      "[crux] observability flush threw while draining a Next invocation; treating as a failed drain.",
      error,
    );
    result = {
      status: "failed",
      delivered: 0,
      rejected: 0,
      remaining: diagnostics.queuedRecords + diagnostics.pendingDeliveries,
      deadlineExceeded: false,
    };
  }

  try {
    const reporting = (
      (options.onDrain ?? warnAboutIncompleteDrain) as (
        result: ObservabilityFlushResult,
      ) => unknown
    )(result);
    void Promise.resolve(reporting).catch((error: unknown) => {
      console.error(
        "[crux] observability onDrain reporter rejected; the Next drain result above was still computed.",
        error,
      );
    });
  } catch (error) {
    console.error(
      "[crux] observability onDrain reporter threw; the Next drain result above was still computed.",
      error,
    );
  }
}

function warnAboutIncompleteDrain(result: ObservabilityFlushResult): void {
  if (result.status === "drained") return;
  console.warn(
    "[crux] observability drain did not fully complete after the Next response; telemetry may be delayed or lost.",
    result,
  );
}
