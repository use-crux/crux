/**
 * Coordinated structured-stream route.
 *
 * A live enforce `assert` commit gate — or a positive `validationRetry` — makes a
 * structured stream transactional (RFC #173): the gate can reject an attempt, so the
 * attempt must be discarded and restreamed without having leaked bytes. This module
 * owns that route. The ordinary progressive stream in `stream-core` is untouched by
 * it, which is why the two live apart: one publishes provider deltas as they clear,
 * the other publishes nothing until an attempt has committed.
 *
 * Core decides *why* and *whether* to retry; the physical attempt loop lives in
 * `stream-attempt`.
 *
 * @internal
 * @module
 */

import type { Message } from "../../generation/messages";
import type {
  AdapterResponse,
  CallArgs,
  StreamCompletionMetadata,
  StreamHandle,
} from "../types";
import type { CoreStepDialect } from "./types";
import type { SafetyStreamSeal } from "../../safety/session";
import type { Safety } from "../../safety/session-contract";
import type {
  JsonSchemaObject,
  StructuredOutputDecodeManifest,
} from "../structured-output";
import type { z } from "zod";
import {
  defaultConstraintFeedbackFormatter,
  openSafetySessionStreamRaw,
  openSafetySessionStructuredStreamRaw,
  safetySessionFeedbackGuard,
  safetySessionStreamCommitPlan,
} from "../../safety/session";
import {
  runCoordinatedStream,
  StreamValidationRejection,
  type StreamAttemptEvent,
  type StreamAttemptStart,
} from "./stream-attempt";
import { runInStreamObservationContext } from "../../generation/stream-observability";
import { composeAbortSignals, withBudget } from "../../generation/timeout";
import { normalizeAdapterCallError } from "../normalized-outcome";
import { normalizeInvocationMessages } from "../../content/invocation-message";
import { createSafetyTextChunk, isSafetyTextChunk } from "./stream-safety";
import { guardStreamCompletion } from "./stream-completion";
import { observe } from "../../observability";
import { sumUsageWhenComplete } from "../result-usage";

/** Everything the coordinated route needs from the prepared streaming call. */
export interface CoordinatedStreamRouteOptions<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown>,
> {
  readonly dialect: CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra>;
  /** The already-orchestrated provider handle; attempt 0 reuses it. */
  readonly handle: StreamHandle<TRawStream>;
  /**
   * Provider-native stream captured during orchestration.
   *
   * Retained for parity with the progressive route's options; the coordinated route does
   * NOT expose it, because attempt zero may be the discarded attempt.
   */
  readonly providerRawStream: TRawStream | undefined;
  readonly callArgs: CallArgs<TExtra>;
  readonly safety: Safety;
  /** Authored schema, when the stream is structured. Absent for a text stream. */
  readonly schema?: z.ZodType;
  readonly messages: readonly Message[];
  readonly promptId: string | undefined;
  readonly modelInfo: { readonly provider: string; readonly modelId: string };
  readonly maxSteps: number;
  readonly signal?: AbortSignal;
  readonly stepTimeoutMs?: number;
  readonly validationRetry?: { readonly maxRetries?: number };
  readonly structuredCanonicalSchema?: JsonSchemaObject;
  readonly structuredDecodeManifest?: StructuredOutputDecodeManifest;
  /** Release tool sources once the logical stream is done, however it ended. */
  readonly closeSources: () => Promise<void>;
  /** Record the completed assistant turn under the owning stream observation. */
  readonly captureTurn: (turn: {
    readonly messages: readonly Message[];
    readonly assistantText: string | undefined;
    readonly toolCalls: unknown;
  }) => Promise<void> | void;
}

/**
 * Whether this stream needs the coordinated route.
 *
 * A positive `validationRetry` is an attempt-wide EOF-and-validate commit gate: it
 * buffers the whole candidate until the authored `safeParse` succeeds, and a failure
 * discards the attempt and restreams under the shared budget. `maxRetries: 0` does
 * NOT create a retry gate (unconditional validation still runs at completion).
 */
export function resolveCommitGates(
  safety: Safety,
  hasSchema: boolean,
  validationRetryMaxRetries: number | undefined,
): { readonly coordinated: boolean; readonly validationGate: boolean } {
  // The validation gate needs a schema to validate against; an `assert` gate does
  // not. A text-boundary assert must coordinate too, or it would terminate on its
  // first failure here while retrying on a loop-owning SDK route — RFC #173 requires
  // both routes to observe the same policy.
  const validationGate = hasSchema && (validationRetryMaxRetries ?? 0) > 0;
  const hasAssertGate =
    safety.enabled && safetySessionStreamCommitPlan(safety).hasAssertGate;
  return {
    coordinated: hasAssertGate || validationGate,
    validationGate,
  };
}

/**
 * Build the public stream handle for a transactional structured stream.
 *
 * Only bytes from an attempt that committed are published; a rejected attempt is
 * discarded and restreamed with corrective feedback under the shared `maxSteps`
 * budget, and exhaustion throws having published nothing.
 */
export function openCoordinatedStructuredStream<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown>,
>(
  options: CoordinatedStreamRouteOptions<
    TClient,
    TRawResponse,
    TRawStream,
    TExtra
  >,
  validationGate: boolean,
): StreamHandle<TRawStream> {
  const {
    dialect,
    handle,
    callArgs,
    safety,
    schema,
    messages,
    promptId,
    modelInfo,
    closeSources,
  } = options;

  const structuredContext =
    options.structuredCanonicalSchema || options.structuredDecodeManifest
      ? {
          ...(options.structuredCanonicalSchema
            ? { canonicalSchema: options.structuredCanonicalSchema }
            : {}),
          ...(options.structuredDecodeManifest
            ? { decodeManifest: options.structuredDecodeManifest }
            : {}),
        }
      : undefined;

  let steps = 0;
  let priorMessages: Message[] = [...messages];
  let accepted:
    | {
        readonly meta: Awaited<ReturnType<typeof handle.completion>>;
        readonly seal: SafetyStreamSeal;
      }
    | undefined;
  /**
   * Provider facts for EVERY billable physical attempt, discarded ones included.
   *
   * Logical `usage` and `cost` are scalar aggregates across all of them (RFC #173,
   * law 7): the caller pays for a rejected attempt, so reporting only the accepted
   * one would silently under-report money on the surface that exists to report it.
   * Nothing else from a discarded attempt is retained — its text, transcript,
   * steps, and warnings stay invisible, which is why logical `usage` deliberately
   * does not equal the sum of public `steps[].usage` once a retry has occurred.
   */
  const billable: Array<Awaited<ReturnType<typeof handle.completion>>> = [];
  /** Record one attempt's billing facts exactly once, however it ended. */
  const recordBilling = async (
    providerHandle: StreamHandle<TRawStream>,
  ): Promise<Awaited<ReturnType<typeof handle.completion>>> => {
    const meta = await providerHandle.completion();
    billable.push(meta);
    return meta;
  };
  // The validation gate's parse of the committed candidate, carried into completion so
  // the authored schema runs exactly once per candidate.
  let committedCandidate:
    | { readonly value: unknown; readonly data: unknown }
    | undefined;

  const assistantResponseFor = (text: string): AdapterResponse => ({
    text,
    toolCalls: undefined,
    usage: undefined,
    finishReason: undefined,
    responseId: undefined,
    actualModelId: undefined,
  });

  // Each attempt streams a fresh provider response through a fresh RAW commit
  // gate; attempt 0 reuses the already-orchestrated provider handle.
  const startAttempt: StreamAttemptStart = async ({
    corrective,
    rejectedOutput,
    attemptIndex,
    cause,
    signal,
  }) => {
    // One `generation.stream.attempt` child span per physical provider stream
    // (emitted for single-attempt streams too), nested under the single logical
    // `generation.stream` so the run id and parent are preserved.
    const attemptSpan = (await runInStreamObservationContext(handle, () =>
      observe.openSpan({
        name: `stream attempt ${attemptIndex}`,
        primitive: "generation.stream.attempt",
        attributes: { attemptIndex, cause },
        implicitRun: false,
      }),
    )) as ReturnType<typeof observe.openSpan>;
    let settled = false;
    const settleOutcome = (
      outcome: "accepted" | "discarded" | "failed" | "cancelled",
      failedPolicies?: readonly string[],
    ): void => {
      if (settled) return;
      settled = true;
      attemptSpan.end({
        attributes: {
          attemptIndex,
          cause,
          outcome,
          ...(failedPolicies && failedPolicies.length > 0
            ? { failedPolicies }
            : {}),
        },
      });
    };
    let providerHandle: StreamHandle<TRawStream>;
    if (attemptIndex === 0) {
      providerHandle = handle;
    } else {
      if (rejectedOutput !== undefined) {
        priorMessages = dialect.appendToolRound(
          [...priorMessages],
          assistantResponseFor(rejectedOutput),
          [],
        );
      }
      priorMessages = [...priorMessages, ...corrective];
      const retryMessages = await normalizeInvocationMessages(priorMessages, {
        provider: modelInfo.provider,
      });
      providerHandle = await withBudget(
        (budgetSignal) =>
          dialect.stream(
            dialect.client,
            { ...callArgs, messages: retryMessages },
            { signal: composeAbortSignals(signal, budgetSignal) },
          ),
        { budget: "step", limitMs: options.stepTimeoutMs },
      ).catch((error: unknown) => {
        throw normalizeAdapterCallError(error, {
          providerId: modelInfo.provider,
          signal: options.signal,
          mapError: dialect.mapError,
        });
      });
    }
    // A structured stream gates object occurrences; a text stream gates whole-text
    // asserts. Both raise the same non-terminal rejection for the coordinator.
    const safetyStream = schema
      ? openSafetySessionStructuredStreamRaw(safety, structuredContext)
      : openSafetySessionStreamRaw(safety);
    // Held so a rejected attempt can actually cancel its provider stream: the
    // coordinator awaits `abort()` before starting the retry, and a no-op there
    // leaves the rejected request live and billable.
    const providerIterator = (
      providerHandle.rawStream as AsyncIterable<unknown>
    )[Symbol.asyncIterator]();
    const events = (async function* (): AsyncGenerator<StreamAttemptEvent> {
      // A DISCARDED attempt is still billable, so its provider facts are recorded
      // even though none of its output is published (RFC #173, law 7). Rejection
      // is raised from inside the gate, before the accepted path reaches
      // `recordBilling`, so the failure path has to collect them itself.
      let billed = false;
      const recordOnce = async (): Promise<void> => {
        if (billed) return;
        billed = true;
        try {
          billable.push(await providerHandle.completion());
        } catch {
          // A provider that cannot report facts for an attempt it already ran
          // leaves the total unknowable; the completeness rule below then omits
          // logical usage rather than under-reporting it.
          billable.push(undefined);
        }
      };
      let committed = false;
      // The model's raw answer for this attempt, so a rejected attempt can be
      // replayed as context in the corrective retry turn.
      let attemptText = "";
      try {
        // Under the validation gate the whole candidate is buffered until
        // `safeParse` succeeds — no early release, even for a scalar assert.
        const heldReleases: string[] = [];
        for await (const chunk of {
          [Symbol.asyncIterator]: () => providerIterator,
        }) {
          const delta = providerHandle.extractTextDelta(chunk);
          if (delta === undefined || delta === "") continue;
          attemptText += delta;
          const directive = await safetyStream.feed(delta);
          if (directive.kind === "hold") continue;
          if (directive.content.length === 0) continue;
          if (validationGate) {
            heldReleases.push(directive.content);
            continue;
          }
          if (!committed) {
            committed = true;
            yield { kind: "committed" };
          }
          yield { kind: "delta", text: directive.content };
        }
        const seal = await safetyStream.finish();
        if (validationGate && schema) {
          // EOF-and-validate: a failed authored parse discards the whole attempt
          // (zero released bytes) and the coordinator restreams / exhausts.
          const check = schema.safeParse(seal.parsed);
          if (check.success) {
            committedCandidate = { value: seal.parsed, data: check.data };
          }
          if (!check.success) {
            throw new StreamValidationRejection({
              error: check.error,
              text: seal.text,
            });
          }
          yield { kind: "committed" };
          for (const held of heldReleases) yield { kind: "delta", text: held };
        } else if (!committed) {
          yield { kind: "committed" };
        }
        if (seal.pending.length > 0)
          yield { kind: "delta", text: seal.pending };
        billed = true;
        const meta = await recordBilling(providerHandle);
        accepted = { meta, seal };
        yield {
          kind: "sealed",
          seal,
          settlement: {
            attemptId: String(attemptIndex),
            settled: seal.settlement?.settled ?? [],
            audit: seal.settlement?.audit ?? [],
          },
        };
      } catch (error) {
        // A rejected attempt already consumed provider tokens. Record them, then
        // let the rejection propagate untouched to the coordinator.
        await recordOnce();
        throw error;
      }
    })();
    return {
      events,
      abort: async () => {
        // Fail-open: cancelling a stream must never mask the rejection that caused it.
        // `events` may be suspended at a `yield`, so close it first, then make sure the
        // provider iterator is closed even if the generator body never reached it.
        try {
          await events.return(undefined as never);
        } catch {
          // ignored
        }
        try {
          await providerIterator.return?.(undefined);
        } catch {
          // ignored
        }
      },
      settleOutcome,
    };
  };

  const coordinated = runCoordinatedStream({
    startAttempt,
    maxSteps: options.maxSteps,
    steps: () => steps,
    incrementStep: () => {
      steps += 1;
    },
    formatFeedback: (failures) => [
      {
        role: "user",
        content: String(
          defaultConstraintFeedbackFormatter.format(failures, {
            promptId,
            model: modelInfo.modelId,
            traceId: undefined,
            metadata: {},
          }),
        ),
      },
    ],
    guardFeedback: safetySessionFeedbackGuard(safety),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(promptId ? { promptId } : {}),
    ...(validationGate && options.validationRetry
      ? { validationRetry: options.validationRetry }
      : {}),
  });

  const gated = (async function* () {
    try {
      for await (const delta of coordinated.deltas) {
        yield createSafetyTextChunk(delta);
      }
    } finally {
      await closeSources();
    }
  })() as unknown as TRawStream & AsyncIterable<unknown>;

  return {
    ...handle,
    // `raw` is the coordinated facade here, NOT a provider attempt. Attempt zero's
    // provider stream may be the DISCARDED attempt, so exposing it would publish content
    // the gates withheld under a property documented as merely "unsafe". A coordinated
    // stream therefore has no ungated provider surface: `raw` and `rawStream` are the
    // same composed logical stream over the accepted attempt.
    raw: gated,
    rawStream: gated,
    extractTextDelta: (chunk: unknown) =>
      isSafetyTextChunk(chunk) ? chunk.text : handle.extractTextDelta(chunk),
    completion: async () => {
      try {
        await coordinated.completion();
        // Logical totals span every billable attempt; everything else in the
        // envelope describes the accepted one (RFC #173, law 7).
        const meta = withBillableTotals(accepted?.meta, billable);
        const guarded = await guardStreamCompletion({
          safety,
          meta,
          assembleWithoutSafety: true,
          liveText: accepted?.seal.text,
          messages,
          ...(schema ? { schema } : {}),
          decodeManifest: options.structuredDecodeManifest,
          ...(options.structuredCanonicalSchema
            ? {
                structuredContext: {
                  canonicalSchema: options.structuredCanonicalSchema,
                  decodeManifest: options.structuredDecodeManifest,
                },
              }
            : {}),
          ...(accepted
            ? {
                sealedCanonicalValue: accepted.seal.parsed,
                objectOccurrencesAlreadyGated: true,
                // Occurrence-precise settlement from THIS accepted attempt only
                // (a rejected attempt never sets `accepted`, so it cannot cross in).
                ...(accepted.seal.settlement
                  ? { constraintSettlement: accepted.seal.settlement.settled }
                  : {}),
              }
            : {}),
          ...(committedCandidate ? { committedCandidate } : {}),
          promptId,
        });
        await runInStreamObservationContext(handle, () =>
          options.captureTurn({
            messages,
            assistantText: guarded?.text || undefined,
            toolCalls: meta?.toolCalls,
          }),
        );
        return guarded;
      } finally {
        await closeSources();
      }
    },
  };
}

/**
 * Attach the LOGICAL scalar totals across every billable physical attempt.
 *
 * @remarks
 * Usage and cost aggregate across all attempts, discarded ones included: the
 * caller paid for each provider call, so reporting only the accepted one
 * under-reports money (RFC #173, law 7). They ride in `logicalTotals` rather than
 * overwriting `usage`/`cost`, because those feed the public STEP facts and a
 * discarded attempt contributes money but no step. Consequently logical `usage`
 * deliberately stops equalling the sum of `steps[].usage` once a retry occurred.
 *
 * The completeness rule holds in both directions: if ANY billable attempt omitted
 * a figure the total is unknowable, so it is omitted rather than under-reported.
 */
function withBillableTotals<TMeta extends StreamCompletionMetadata | undefined>(
  meta: TMeta,
  billable: ReadonlyArray<StreamCompletionMetadata | undefined>,
): TMeta {
  // One attempt needs no aggregate: the accepted facts already are the totals.
  if (meta === undefined || billable.length < 2) return meta;
  const usage = sumUsageWhenComplete(
    billable.map((attempt) => ({
      content: [],
      finishReason: undefined,
      responseId: undefined,
      modelId: undefined,
      ...(attempt?.usage !== undefined ? { usage: attempt.usage } : {}),
    })),
  );
  const costs = billable.map((attempt) => attempt?.cost);
  const cost = costs.every((entry) => entry !== undefined)
    ? costs.reduce<number>((total, entry) => total + (entry ?? 0), 0)
    : undefined;
  return {
    ...meta,
    logicalTotals: {
      ...(usage !== undefined ? { usage } : {}),
      ...(cost !== undefined ? { cost } : {}),
    },
  };
}
