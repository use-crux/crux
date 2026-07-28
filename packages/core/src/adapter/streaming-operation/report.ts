import type { CompletedOperationProviderPayload } from "../../completed-operation/contracts";
import { safeCompletedOperationReport } from "../completed-operation/report";
import type { StreamingOperationDefinition } from "./definition";

/** Run provider quality reporting once and expose only its safe descriptor. */
export function emitStreamingOperationReport<
  TModel,
  TInput,
  TNormalized,
  TNativeEvent,
  TNativeResult,
  TEvent,
  TResult extends CompletedOperationProviderPayload,
  TReport,
>(
  definition: StreamingOperationDefinition<
    TModel,
    TInput,
    TNormalized,
    TNativeEvent,
    TNativeResult,
    TEvent,
    TResult,
    TReport
  >,
  options: Readonly<{
    provider: string;
    operation: "streamImage" | "streamSpeech";
    model: TModel;
    onReport?: (report: unknown) => void;
  }>,
  result: TResult,
  normalized: TNormalized,
) {
  try {
    const report = safeCompletedOperationReport(
      definition.report(result, normalized, {
        provider: options.provider,
        operation: options.operation,
        model: options.model,
      }),
    );
    if (report) {
      try {
        options.onReport?.(report);
      } catch {
        // Report sinks have diagnostic authority only.
      }
    }
    return report;
  } catch {
    // Provider quality reporting must never change a successful result.
    return undefined;
  }
}
