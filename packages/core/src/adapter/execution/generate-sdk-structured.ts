/**
 * Structured-output execution for SDK-loop adapters.
 *
 * SDK executors perform exactly one structured attempt at a time. This module
 * owns the Crux corrective-retry loop around those attempts and routes every
 * completed candidate through the shared completed-candidate pipeline, so the
 * SDK route enforces the same invariant as the native route:
 *
 * ```text
 * provider wire value
 *   -> decode compilation manifest to canonical z.input
 *   -> completed-output Safety over z.input
 *   -> authored Zod safeParse exactly once
 *   -> constraints -> expose safeParse.data as z.output
 * ```
 *
 * Core owns compilation: it resolves the model's inert capabilities from the
 * runtime, compiles one plan, installs `plan.outputSchema` as the SDK's wire
 * validator (never the authored Zod schema), and retains the manifest.
 *
 * @internal
 * @module
 */

import type { z } from "zod";
import type { Message } from "../../generation/messages";
import {
  composeAbortSignals,
  createBudgetSignal,
} from "../../generation/timeout";
import { type Safety, safetySessionFeedbackGuard } from "../../safety/session";
import { guardCorrectiveWriteback } from "../../safety/session-feedback-guard";
import type { ExecutorRequest, StructuredRequest } from "../executor-types";
import { type StructuredOutputPlan } from "../structured-output";
import type { ResultStepFacts } from "../result-accumulator";
import type { AdapterResponse } from "../types";
import type {
  AdapterExecutionGenerateArgs,
  AdapterExecutionGenerateResultWithoutRunId,
  SdkLoopDialect,
} from "./types";
import { appendCorrectiveMessages } from "./messages";
import { buildTraceMeta } from "./metadata";
import { createStructuredCompletion } from "./structured-completion";
import { finalizeSdkResultEnvelope } from "./sdk-result-envelope";
import { attachCachedStructuredCandidate } from "../../runtime/internal/cached-structured-candidate";

/** Inputs shared by the SDK-loop structured retry helper. */
interface GenerateSdkStructuredContext<TModel, TRawResponse, TRawStream> {
  /** Normalized SDK-loop dialect for one bound SDK client. */
  readonly dialect: SdkLoopDialect<TModel, TRawResponse, TRawStream>;
  /** Original prepared execution arguments, including retry hooks. */
  readonly args: AdapterExecutionGenerateArgs<TModel, Record<string, unknown>>;
  /** Fully prepared executor request for the current model attempt. */
  readonly request: ExecutorRequest<TModel>;
  /** Zod schema that the structured output must satisfy. */
  readonly schema: z.ZodType;
  /** Provider-specific plan compiled before middleware/cache lookup. */
  readonly plan: StructuredOutputPlan;
  /** Safety session created by the parent SDK-loop execution. */
  readonly safety: Safety;
  /** Stable retry id used for validation instrumentation hooks. */
  readonly retryId: string;
  /** Prompt id for exhaustion diagnostics. */
  readonly promptId: string | undefined;
  /** Shared provider-call budget for validation and constraint retries. */
  readonly maxSteps: number;
  /** Step facts collected by the parent SDK-loop execution. */
  readonly stepFacts: ResultStepFacts[];
}

/**
 * Run the SDK structured-output corrective retry loop.
 *
 * The first attempt is issued here; validation retry and constraint
 * regeneration are owned by the shared completed-candidate pipeline, which
 * re-calls the provider through the `reprompt` seam under one shared
 * `maxSteps` budget.
 *
 * @param ctx - Structured retry context prepared by `generateSdk()`.
 * @returns The normalized structured generation result.
 */
export async function generateSdkStructured<TModel, TRawResponse, TRawStream>(
  ctx: GenerateSdkStructuredContext<TModel, TRawResponse, TRawStream>,
): Promise<AdapterExecutionGenerateResultWithoutRunId<TRawResponse>> {
  const { dialect, args, request, schema, plan, safety, promptId, stepFacts } =
    ctx;

  const validationRetry = args.validationRetry;
  let steps = 0;
  let currentMessages = request.messages ? [...request.messages] : [];
  let currentPrompt = request.prompt;
  let lastText = "";
  let lastRaw: TRawResponse | undefined;
  let lastResponse: AdapterResponse = {
    text: "",
    toolCalls: undefined,
    usage: undefined,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: request.modelInfo.modelId,
  };

  // One structured attempt: installs the wire schema, applies the per-attempt
  // step budget, and counts one provider call against the shared budget.
  const attemptOnce = async (attemptRequest: StructuredRequest<TModel>) => {
    const attemptBudget = createBudgetSignal({
      budget: "step",
      limitMs: args.timeout?.stepMs,
    });
    const requestWithSignal = {
      ...attemptRequest,
      abortSignal: composeAbortSignals(
        request.abortSignal,
        attemptBudget.signal,
      ),
    };
    steps++;
    try {
      return await dialect.runStructuredAttempt(requestWithSignal);
    } finally {
      attemptBudget.dispose();
    }
  };

  const buildAttemptRequest = (): StructuredRequest<TModel> => ({
    ...request,
    prompt: currentPrompt,
    messages: currentMessages,
    schema,
    outputSchema: plan.outputSchema,
  });

  const first = await attemptOnce(buildAttemptRequest());
  if (first.status === "ok") {
    lastRaw = first.raw;
    lastResponse = first.response;
    lastText = first.response.text;
  } else {
    lastText = first.rawText;
    lastResponse = { ...lastResponse, text: first.rawText };
  }

  const completion = createStructuredCompletion({
    safety,
    schema,
    decodeManifest: plan.decodeManifest,
    promptId: promptId ?? "unknown",
    validationRetry,
    maxSteps: ctx.maxSteps,
    steps: () => steps,
    messages: () => currentMessages,
    // Re-call the provider with corrective messages, shared by validation retry
    // and constraint regeneration. Owns SDK step-fact accounting and returns the
    // new candidate text; the pipeline decodes and re-validates it.
    reprompt: async (corrective, writeback): Promise<string> => {
      const guardedWriteback = await guardCorrectiveWriteback({
        ...writeback,
        rejectedOutput: writeback.rejectedOutput || "Invalid output",
        corrective,
        guard: safetySessionFeedbackGuard(safety),
      });
      currentMessages = appendCorrectiveMessages(
        currentPrompt,
        currentMessages,
        guardedWriteback.rejectedOutput,
        guardedWriteback.corrective,
      );
      currentPrompt = undefined;
      // The candidate being corrected is superseded: record it as an empty
      // step. The winning candidate becomes the final step via the envelope.
      stepFacts.push({
        content: [],
        finishReason: undefined,
        responseId: undefined,
        modelId: undefined,
      });
      const regen = await attemptOnce(buildAttemptRequest());
      if (regen.status === "ok") {
        lastRaw = regen.raw;
        lastResponse = regen.response;
        lastText = regen.response.text;
        return regen.response.text;
      }
      lastText = regen.rawText;
      lastResponse = { ...lastResponse, text: regen.rawText };
      return regen.rawText;
    },
  });

  const initial =
    first.status === "ok"
      ? completion.buildFromWireValue({
          text: first.response.text,
          value: first.wireValue,
        })
      : completion.buildFromText(first.rawText);

  const result = await completion.finalize(initial, { suspended: false });
  const finalText = result.text;

  const resultMessages: Message[] = [
    ...(currentMessages.length > 0
      ? currentMessages
      : currentPrompt
        ? [{ role: "user" as const, content: currentPrompt }]
        : []),
    { role: "assistant" as const, content: finalText },
  ];

  const envelope = finalizeSdkResultEnvelope({
    raw: lastRaw,
    response: lastResponse,
    text: finalText,
    object: result.object,
    _meta: buildTraceMeta({
      response: { ...lastResponse, text: finalText },
    }),
    messages: resultMessages,
    stepFacts,
    finalStepMode: stepFacts.length < steps ? "append" : "replace",
  });
  return attachCachedStructuredCandidate(envelope, result.canonicalInput);
}
