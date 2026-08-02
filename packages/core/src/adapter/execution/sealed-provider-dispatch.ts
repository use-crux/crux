/** Validated provider dispatch with immediate preparation-statistics accounting. @internal */

import { isCruxAdapterError } from "../normalized-outcome";
import type { PreparationStatistics } from "../../request/prepare/statistics";
import type { StatisticsUsageReport } from "../../statistics";

/** Content-free provider facts available after one normalized call settles. @internal */
export interface ProviderDispatchSettlement {
  /** Provider-reported usage, absent when the provider did not report it. */
  readonly usage?: StatisticsUsageReport;
  /** Additional physical retries for this same sealed semantic request. */
  readonly transportRetries?: number;
}

/**
 * Validate and dispatch one sealed provider request.
 *
 * Validation remains pre-dispatch and uncounted. Once it passes, the semantic
 * start is committed immediately before provider I/O; normalized settlement
 * then commits exactly one terminal fact and its reported retry count.
 *
 * @internal
 */
export async function dispatchSealedProvider<TRequest, TResponse>(input: {
  readonly request: TRequest;
  readonly model: string;
  readonly statistics?: PreparationStatistics;
  readonly validate: () => Promise<void>;
  readonly call: (request: TRequest) => Promise<TResponse>;
  readonly settlement: (response: TResponse) => ProviderDispatchSettlement;
  readonly recordRetries: (transportRetries: number | undefined) => void;
}): Promise<TResponse> {
  await input.validate();
  input.statistics?.recordStarted(input.model);
  try {
    const response = await input.call(input.request);
    const settlement = input.settlement(response);
    input.recordRetries(settlement.transportRetries);
    input.statistics?.recordTerminal({
      model: input.model,
      outcome: "succeeded",
      usage: settlement.usage,
      transportRetries: settlement.transportRetries,
    });
    return response;
  } catch (error) {
    input.statistics?.recordTerminal({
      model: input.model,
      outcome:
        isCruxAdapterError(error) && error.providerError.kind === "aborted"
          ? "cancelled"
          : "failed",
    });
    throw error;
  }
}
