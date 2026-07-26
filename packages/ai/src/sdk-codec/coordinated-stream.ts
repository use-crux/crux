import { isStreamAttemptRejection } from "@use-crux/core/adapter";
import { extractCost, normalizeUsage } from "../meta";
import type {
  CoordinatedStreamPlan,
  ExecutorProviderStreamHandle,
  ExecutorRequest,
  ExecutorStreamCompletionPayload,
  JsonSchemaObject,
  SdkStreamAttempt,
} from "@use-crux/core/adapter";
import type { LanguageModel } from "ai";
import type { z } from "zod";
import type { SdkGateway } from "../gateway";
import { createCoordinatedPartStream } from "./coordinated-parts";
import { withLegacyStreamMeta } from "./stream-meta";
import type { AiSdkCodecDeps, SdkStreamResultLike } from "./types";

/**
 * Execute core's coordinated-stream plan against the AI SDK (RFC #173, Fork A).
 *
 * The boundary: **core decides why and whether to retry; this module decides how an
 * AI SDK stream is physically represented.** Core hands over a plan; each attempt runs a
 * fresh `streamText` whose safety transform holds every byte until that attempt's commit
 * gates resolve. Because core's gate releases nothing while a gate is unresolved,
 * anything the transform emits is already committed — so released parts are forwarded
 * immediately (early unlock is preserved, matching the native route) and a rejected
 * attempt provably leaked nothing.
 *
 * A discarded attempt contributes no model CONTENT: no text, reasoning, tool event,
 * source, or media part of it is forwarded, its `onFinish` never fires for the caller,
 * and its completion never resolves.
 *
 * Its provider FRAMING (`start`, `start-step`, `text-start`, …) is forwarded, and
 * deliberately so: the SDK emits framing before the first text delta, and holding it
 * would make the early-unlock check permanently false and buffer every stream to EOF.
 * Framing carries no model output, and it is not public either way — the logical
 * publication seam owns `start`/`finish` and drops every physical frame, so this object
 * is an INTERNAL composition rather than something a caller can observe.
 *
 * @internal
 */
export async function runCoordinatedStream(
  request: ExecutorRequest<LanguageModel> & {
    readonly schema?: z.ZodType;
    readonly outputSchema?: JsonSchemaObject;
    readonly streamPlan: CoordinatedStreamPlan;
  },
  gateway: SdkGateway,
  createPlan: (
    attemptRequest: ExecutorRequest<LanguageModel> & {
      readonly schema?: z.ZodType;
      readonly outputSchema?: JsonSchemaObject;
    },
    deps: AiSdkCodecDeps,
  ) => Promise<{
    readonly method: "streamText" | "streamObject";
    readonly args: unknown;
    attach(raw: unknown): ExecutorProviderStreamHandle<SdkStreamResultLike>;
  }>,
  deps: AiSdkCodecDeps,
): Promise<ExecutorProviderStreamHandle<SdkStreamResultLike>> {
  const parts = createCoordinatedPartStream();
  let resolveCompletion!: (value: ExecutorStreamCompletionPayload) => void;
  let rejectCompletion!: (error: unknown) => void;
  const completionPromise = new Promise<ExecutorStreamCompletionPayload>(
    (resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    },
  );
  // The caller may await completion without draining, or drain without awaiting.
  void completionPromise.catch(() => undefined);

  /**
   * Provider facts for every billable physical attempt, discarded ones included.
   *
   * Logical `usage`/`cost` aggregate across all of them (RFC #173, law 7): the
   * caller paid for each provider call. Nothing else from a discarded attempt is
   * retained, so logical usage deliberately stops equalling the sum of public
   * `steps[].usage` once a retry occurred.
   */
  const billable: Array<ExecutorStreamCompletionPayload | undefined> = [];

  const drive = async (): Promise<void> => {
    let attempt: SdkStreamAttempt | undefined = await request.streamPlan.beginAttempt();
    let rejectedText = "";
    while (attempt) {
      const current: SdkStreamAttempt = attempt;
      // Whether THIS attempt's billing has been recorded, so the accept and
      // reject paths cannot double-count it.
      let billed = false;
      // Usage/cost read straight off the provider's `finish` part.
      //
      // A DISCARDED attempt's rejection is raised by the Safety transform at
      // stream end, BEFORE the SDK calls `onFinish`, so `handle.completion()`
      // never resolves for it. The provider still reported its billing in the
      // part stream, and the caller was still charged for it — so it is captured
      // here rather than lost (RFC #173, law 7).
      let observedBilling: ExecutorStreamCompletionPayload | undefined;
      // Only this attempt's safety stream gates this attempt; corrective turns carry
      // the rejected answer plus core's feedback (never re-running settled tools —
      // the conversation is replayed, not re-executed).
      const attemptRequest = {
        ...request,
        // Core owns the shared budget; this attempt may consume at most its grant, so
        // the SDK's own multi-step loop is capped rather than free to run `maxSteps`
        // model steps inside one invocation.
        maxSteps: Math.min(request.maxSteps ?? current.remainingSteps, current.remainingSteps),
        safety: current.safety,
        // COMPOSED, not replaced: `request.abortSignal` carries the caller signal AND the
        // step-timeout budget. Overwriting it with the attempt signal silently stopped
        // `timeout.stepMs` from applying to coordinated streams, while the native route
        // still enforced it.
        abortSignal: anySignal(request.abortSignal, current.signal),
        messages: withCorrective(request.messages, rejectedText, current),
      } as ExecutorRequest<LanguageModel> & {
        readonly schema?: z.ZodType;
        readonly outputSchema?: JsonSchemaObject;
      };
      const held: unknown[] = [];
      let attemptText = "";
      // Model steps observed on THIS invocation, counted from the SDK's own step
      // markers. Visible to the catch block, unlike a `try`-scoped binding.
      let observedSteps = 0;
      // Visible to the catch block too: a DISCARDED attempt's billing facts are
      // read from the same handle after the rejection is raised.
      let attemptHandle:
        | ReturnType<Awaited<ReturnType<typeof createPlan>>["attach"]>
        | undefined;
      try {
        // Inside the try: a throw here (for example the compiled-schema guard) must still
        // settle this attempt's span and release its abort listener rather than leaving
        // the span open forever.
        const call = await createPlan(attemptRequest, deps);
        const raw = (
          call.method === "streamText"
            ? gateway.streamText(call.args as Parameters<SdkGateway["streamText"]>[0])
            : gateway.streamObject(call.args as Parameters<SdkGateway["streamObject"]>[0])
        ) as unknown as SdkStreamResultLike;
        const handle = call.attach(raw);
        attemptHandle = handle;
        for await (const part of fullStreamOf(raw)) {
          if ((part as { type?: string }).type === "start-step") observedSteps += 1;
          // Billing framing, when the SDK gets far enough to emit it. A REJECTED
          // attempt never does: the Safety transform raises from its flush, and
          // the SDK synthesizes `finish-step`/`finish` downstream of the
          // transform, so a discarded attempt's parts stop at `text-end`.
          if ((part as { type?: string }).type === "finish-step") {
            const step = part as {
              readonly usage?: Parameters<typeof normalizeUsage>[0];
              readonly providerMetadata?: unknown;
            };
            const usage = normalizeUsage(step.usage);
            const cost = extractCost(step.providerMetadata);
            observedBilling = addStepBilling(observedBilling, usage, cost);
          }
          const text = textOf(part);
          if (text) attemptText += text;
          // Core's safety transform gates TEXT only: a text part it emits is already
          // committed. Content-bearing non-text parts (reasoning, tool events, sources)
          // pass through ungated, so they stay behind the commit gate or a discarded
          // attempt would leak them; once one is held, everything after it is held too so
          // the caller never observes reordered parts.
          //
          // Structural framing (`start`, `start-step`, `text-start`, …) carries no model
          // content. It must be forwarded, because the SDK emits it BEFORE the first text
          // delta — treating it as held made `held.length === 0` permanently false and
          // silently disabled early unlock for the whole stream.
          const structural = isStructuralPart(part);
          const forwardable =
            !current.bufferUntilValidated &&
            (structural || text !== undefined) &&
            (structural || held.length === 0);
          if (forwardable) parts.push(part);
          else held.push(part);
        }
        const meta = await handle.completion();
        billable.push(meta);
        billed = true;
        // Core owns the authoritative parse: a validation-gated candidate is validated
        // here, before anything is accepted, so an invalid attempt publishes no text and
        // no non-text parts. A failure throws into the catch below and is retried (or
        // surfaced) by core's policy.
        await current.validateCandidate();
        reportConsumption(observedSteps, current);
        current.accept();
        for (const part of held) parts.push(part);
        parts.close();
        resolveCompletion(withBillableTotals(meta ?? {}, billable));
        return;
      } catch (error) {
        // A DISCARDED attempt is still billable: record its provider facts so the
        // logical totals span every provider call the caller paid for (RFC #173,
        // law 7). None of its OUTPUT is published.
        if (!billed) {
          billed = true;
          // Usually `undefined` here, and deliberately so: the attempt was
          // billed but the SDK never reported how much. Recording the unknown
          // makes the logical total omit itself rather than under-report the
          // accepted attempt's figures as if they were the whole cost
          // (RFC #173, law 7).
          billable.push(observedBilling);
        }
        // A provider/transport failure or a caller abort is NOT a policy discard. Settle
        // the span truthfully and let the error propagate; only a rejection goes through
        // `reject()`, which records `discarded`.
        if (!isStreamAttemptRejection(error)) {
          current.settle(
            (request.abortSignal?.aborted ?? false) ? "cancelled" : "failed",
          );
          throw error;
        }
        rejectedText = attemptText;
        // Report before rejecting so core decides retry-safety from REAL consumption.
        // `observedSteps` is counted in this scope; reading the SDK result's `steps` here
        // would resolve to the composite declared below and report one step per
        // invocation no matter how many the SDK actually ran.
        reportConsumption(observedSteps, current);
        // Core owns eligibility: this returns the next attempt or throws the typed
        // public terminal error. Nothing was forwarded, so nothing must be retracted.
        attempt = await current.reject(error);
      }
    }
  };

  drive().catch((error: unknown) => {
    parts.fail(error);
    rejectCompletion(error);
  });

  let fullSurface: ReturnType<typeof parts.surface> | undefined;
  let textSurface: ReturnType<typeof parts.surface<string>> | undefined;

  const raw: SdkStreamResultLike = {
    // The composed part sequence, and nothing else.
    //
    // This object is INTERNAL: core publishes it through the logical stream seam,
    // which owns every terminal fact. It deliberately does not emulate an AI SDK
    // result's promised getters (`text`, `object`, `usage`, `finishReason`,
    // `response`, `steps`, `toUIMessageStream`, …). Reconstructing those here
    // would be a second, weaker source of truth for facts that belong on one
    // completion envelope — and a discarded attempt could differ from it.
    //
    // Surfaces are genuine `ReadableStream`s that are also async-iterable, created
    // LAZILY so an unread one never materializes a second copy of the stream.
    get fullStream() {
      return (fullSurface ??= parts.surface());
    },
    get textStream() {
      return (textSurface ??= parts.surface<string>((part) => textOf(part)));
    },
    _meta: { _streamCompletion: completionPromise },
  };
  return withLegacyStreamMeta(
    { raw, completion: () => completionPromise },
    completionPromise,
  );
}

/** Append the rejected answer and core's corrective turn for a retry attempt. */
function withCorrective(
  messages: ExecutorRequest<LanguageModel>["messages"],
  rejectedText: string,
  attempt: SdkStreamAttempt,
): ExecutorRequest<LanguageModel>["messages"] {
  if (attempt.corrective.length === 0) return messages;
  const base = [...(messages ?? [])];
  if (rejectedText.length > 0) {
    base.push({ role: "assistant", content: rejectedText } as never);
  }
  return [...base, ...attempt.corrective] as ExecutorRequest<LanguageModel>["messages"];
}

/**
 * Report this invocation's ACTUAL model-step consumption to core.
 *
 * @remarks
 * Counted from the SDK's own `start-step` markers on the part stream rather than the
 * result's `steps` promise, which only settles once the stream runs to completion — a
 * discarded attempt abandons its stream, so awaiting that promise would hang forever.
 *
 * Zero observed steps means consumption is UNKNOWN (the stream failed before the SDK
 * announced a step), so nothing is reported and core fails closed. Guessing "one step"
 * would let an SDK tool loop run outside the shared budget and could replay settled,
 * side-effecting tool rounds on a retry.
 *
 * A multi-step invocation is reported as non-resumable: this route replays only the
 * rejected assistant text, so completed tool rounds cannot be safely continued.
 */
function reportConsumption(observedSteps: number, attempt: SdkStreamAttempt): void {
  if (!Number.isSafeInteger(observedSteps) || observedSteps < 1) return;
  attempt.reportSteps({ steps: observedSteps, resumable: observedSteps <= 1 });
}

function fullStreamOf(raw: SdkStreamResultLike): AsyncIterable<unknown> {
  const stream = raw.fullStream;
  if (stream && typeof stream === "object" && Symbol.asyncIterator in stream) {
    return stream as AsyncIterable<unknown>;
  }
  return (async function* () {})();
}

function textOf(part: unknown): string | undefined {
  const candidate = part as { type?: string; text?: string };
  return candidate?.type === "text-delta" && typeof candidate.text === "string"
    ? candidate.text
    : undefined;
}



/** Framing parts that carry no model output and are safe to forward pre-commitment. */
const STRUCTURAL_PARTS: ReadonlySet<string> = new Set([
  "start",
  "start-step",
  "finish-step",
  "finish",
  "text-start",
  "text-end",
]);

function isStructuralPart(part: unknown): boolean {
  const type = (part as { type?: unknown } | undefined)?.type;
  return typeof type === "string" && STRUCTURAL_PARTS.has(type);
}

/** Compose abort signals without assuming a runtime `AbortSignal.any`. */
function anySignal(...signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal | undefined {
  const live = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];
  const anyOf = (AbortSignal as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyOf === "function") return anyOf(live);
  const controller = new AbortController();
  for (const signal of live) {
    if (signal.aborted) {
      controller.abort((signal as { reason?: unknown }).reason);
      break;
    }
    signal.addEventListener(
      "abort",
      () => controller.abort((signal as { reason?: unknown }).reason),
      { once: true },
    );
  }
  return controller.signal;
}

/**
 * Attach the logical scalar totals across every billable attempt.
 *
 * @remarks
 * Mirrors the native route: totals ride in `logicalTotals` rather than
 * overwriting `usage`/`cost`, because those describe the ACCEPTED attempt and
 * feed the public step facts. A figure is omitted when some billable attempt did
 * not report it — unknowable beats under-reported (RFC #173, law 7).
 */
function withBillableTotals(
  meta: ExecutorStreamCompletionPayload,
  billable: ReadonlyArray<ExecutorStreamCompletionPayload | undefined>,
): ExecutorStreamCompletionPayload {
  // One attempt needs no aggregate: the accepted facts already are the totals.
  if (billable.length < 2) return meta;
  const usages = billable.map((attempt) => attempt?.usage);
  const usage = usages.every((entry) => entry !== undefined)
    ? usages.reduce((total, entry) => ({
        ...entry,
        inputTokens: total.inputTokens + entry.inputTokens,
        outputTokens: total.outputTokens + entry.outputTokens,
        totalTokens: total.totalTokens + entry.totalTokens,
      }))
    : undefined;
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

/** Accumulate one provider step's billing into an attempt's running total. */
function addStepBilling(
  current: ExecutorStreamCompletionPayload | undefined,
  usage: ReturnType<typeof normalizeUsage>,
  cost: number | undefined,
): ExecutorStreamCompletionPayload | undefined {
  // An unmetered step makes the attempt's total unknowable, which propagates
  // into the logical total rather than being silently treated as zero.
  if (usage === undefined) return current ?? {};
  const previous = current?.usage;
  return {
    ...current,
    usage: previous
      ? {
          ...usage,
          inputTokens: previous.inputTokens + usage.inputTokens,
          outputTokens: previous.outputTokens + usage.outputTokens,
          totalTokens: previous.totalTokens + usage.totalTokens,
        }
      : usage,
    ...(cost !== undefined ? { cost: (current?.cost ?? 0) + cost } : {}),
  };
}
