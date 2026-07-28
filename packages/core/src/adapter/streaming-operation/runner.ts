import {
  validateOperationTimeout,
  type CompletedOperationProviderPayload,
  type OperationTimeout,
} from "../../completed-operation/contracts";
import {
  composeAbortSignals,
  createBudgetSignal,
  withAbortSignal,
} from "../../generation/timeout";
import type { WithOperationResultMeta } from "../../observability";
import { withOperationResultMeta } from "../../observability/internal/result-meta";
import { attachRoutingToError } from "../../routing/receipt";
import type { Guardrail } from "../../safety/guardrail/types";
import { safetyEnforcesOutputMedia } from "../../safety/session";
import type { SafetyTuneOptions } from "../../safety/tune";
import {
  resolveCompletedModel,
  type CompletedRoutingState,
} from "../completed-operation/routing";
import {
  createMediaOperationSafety,
  guardMediaOperationInput,
} from "../completed-operation/safety/execute";
import { runStreamingAttempt } from "./attempt";
import type { StreamingOperationDefinition } from "./definition";
import { withoutStreamingSafetyControls } from "./input";
import { describeStreamingModel } from "./model";
import {
  classifyStreamingTerminal,
  openStreamingOperationObservation,
} from "./observability";
import { describeStreamingEvent } from "./progress";
import { emitStreamingOperationReport } from "./report";
import {
  createStreamingOperationResult,
  type StreamingOperationBoundaryEvent,
} from "./result";
import {
  createStreamingRoutingTracker,
  preflightStreamingCandidates,
} from "./routing";
import type { StreamingOperationResult } from "./runner-types";
import type { StreamingFinalEvent } from "./safety/final";

/** Eagerly drive one bounded provider source into a managed logical stream. */
export async function runStreamingOperation<
  TModel,
  TInput,
  TNormalized,
  TNativeEvent,
  TNativeResult,
  TEvent,
  TResult extends CompletedOperationProviderPayload,
  TReport = unknown,
>(
  options: Readonly<{
    definition: StreamingOperationDefinition<
      TModel,
      TInput,
      TNormalized,
      TNativeEvent,
      TNativeResult,
      TEvent,
      TResult,
      TReport
    >;
    provider: string;
    operation: "streamImage" | "streamSpeech";
    model: TModel;
    input: TInput;
    abortSignal?: AbortSignal;
    guardrails?: readonly Guardrail[];
    safety?: SafetyTuneOptions;
    routing?: object;
    route?: string;
    timeout?: OperationTimeout;
    onReport?: (report: unknown) => void;
  }>,
): Promise<
  StreamingOperationResult<
    TEvent | StreamingFinalEvent | StreamingOperationBoundaryEvent,
    WithOperationResultMeta<TResult>
  >
> {
  validateOperationTimeout(options.timeout);
  options.abortSignal?.throwIfAborted();
  const totalBudget = createBudgetSignal({
    budget: "total",
    limitMs: options.timeout?.totalMs,
  });
  const controller = new AbortController();
  const signal =
    composeAbortSignals(
      options.abortSignal,
      totalBudget.signal,
      controller.signal,
    ) ?? controller.signal;
  signal.throwIfAborted();

  const observation = openStreamingOperationObservation({
    provider: options.provider,
    operation: options.operation,
    model: describeStreamingModel(options.model),
    route: options.route,
  });
  try {
    return await withAbortSignal(
      () =>
        Promise.resolve(
          observation.withContext(async () => {
            const safety = createMediaOperationSafety({
              operation: options.operation,
              model: options.model,
              guardrails: options.guardrails,
              safety: options.safety,
            });
            const guardedInput = await guardMediaOperationInput(
              options.operation,
              options.input,
              safety,
            );
            const providerInput = withoutStreamingSafetyControls(guardedInput);
            const prepared = await preflightStreamingCandidates(
              { ...options, model: options.model, input: providerInput },
              signal,
            );
            const meta = Object.freeze({
              traceId: observation.traceId,
              spanId: observation.spanId,
            });
            const managed = createStreamingOperationResult<
              TEvent | StreamingFinalEvent,
              WithOperationResultMeta<TResult>
            >({
              runId: observation.runId,
              meta,
              signal,
              onCancel: (reason) => controller.abort(reason),
              onSettle: () => totalBudget.dispose(),
            });
            const holdDeltas =
              safety !== undefined && safetyEnforcesOutputMedia(safety);
            const policyErrors = new Set<unknown>();
            const routingState: CompletedRoutingState = { calls: 0 };
            const routingTracker = createStreamingRoutingTracker();
            let attemptCount = 0;
            const publish = (event: TEvent | StreamingFinalEvent): boolean => {
              const published = managed.publisher.publish(event);
              if (published) {
                const descriptor = describeStreamingEvent(event);
                if (descriptor) observation.published(descriptor);
              }
              return published;
            };

            void Promise.resolve(
              observation.withContext(async () => {
                const accepted = await resolveCompletedModel(
                  options.model,
                  {
                    input: providerInput,
                    context: options.routing,
                    route: options.route,
                    signal,
                    stepMs: options.timeout?.stepMs,
                    canReplace: () =>
                      !managed.publisher.published() &&
                      !managed.publisher.settled(),
                    shouldStop: (error) => policyErrors.has(error),
                  },
                  routingState,
                  async (model, attemptSignal) => {
                    attemptCount += 1;
                    const trackedAttempt = routingTracker.start(model);
                    const attemptObservation = observation.startAttempt({
                      model: describeStreamingModel(model) ?? "unknown",
                    });
                    const normalized = prepared.get(model);
                    if (normalized === undefined) {
                      const error = new TypeError(
                        "Routing selected an unprepared streaming model candidate.",
                      );
                      attemptObservation.fail(error, "error");
                      throw error;
                    }
                    try {
                      const value = await attemptObservation.withContext(() =>
                        runStreamingAttempt({
                          definition: options.definition,
                          provider: options.provider,
                          operation: options.operation,
                          model: model as TModel,
                          normalized,
                          signal: attemptSignal,
                          safety,
                          holdDeltas,
                          publish,
                          policyError: (error) => policyErrors.add(error),
                          observation: attemptObservation,
                          call: async (operation, start) => {
                            if (!operation.trim()) {
                              throw new TypeError(
                                "Streaming child operation must have a name.",
                              );
                            }
                            routingState.calls += 1;
                            return start();
                          },
                        }),
                      );
                      routingTracker.succeed(trackedAttempt);
                      attemptObservation.succeed();
                      return value;
                    } catch (error) {
                      routingTracker.fail(trackedAttempt, error);
                      attemptObservation.fail(
                        error,
                        classifyStreamingTerminal(error, attemptSignal),
                      );
                      throw error;
                    }
                  },
                );
                for (const event of accepted.events) publish(event);
                const selectedModel = routingState.selectedModel as TModel;
                const normalized = prepared.get(routingState.selectedModel);
                const report =
                  normalized === undefined
                    ? undefined
                    : emitStreamingOperationReport(
                        options.definition,
                        {
                          provider: options.provider,
                          operation: options.operation,
                          model: selectedModel,
                          onReport: options.onReport,
                        },
                        accepted.result,
                        normalized,
                      );
                const receipt = routingTracker.receipt(
                  options.model,
                  routingState.selectedModel,
                  options.route,
                );
                const routed = receipt
                  ? (Object.freeze({
                      ...accepted.result,
                      routing: receipt,
                    }) as TResult)
                  : accepted.result;
                const result = withOperationResultMeta(routed, meta);
                observation.succeed({
                  model: describeStreamingModel(selectedModel) ?? "unknown",
                  calls: routingState.calls || accepted.result.execution.calls,
                  attemptCount,
                  report,
                });
                managed.publisher.complete(result);
              }),
            ).catch((error: unknown) => {
              const receipt = routingTracker.receipt(
                options.model,
                routingState.selectedModel,
                options.route,
                managed.publisher.published(),
              );
              if (receipt && error instanceof Error) {
                attachRoutingToError(error, receipt);
              }
              observation.fail(error, classifyStreamingTerminal(error, signal));
              managed.publisher.fail(error);
            });

            return managed.result;
          }),
        ),
      signal,
    );
  } catch (error) {
    totalBudget.dispose();
    observation.fail(error, classifyStreamingTerminal(error, signal));
    throw error;
  }
}
