/**
 * Core-step streaming execution.
 *
 * This module prepares a provider stream for raw SDK adapters, wraps it with
 * Crux stream safety, and captures completion metadata/memory without
 * replacing the provider's raw stream contract.
 *
 * @internal
 * @module
 */

import type { MiddlewareResult } from "../../runtime/types";
import type { Message } from "../../generation/messages";
import {
  createSafetyWithBindingApplicability,
  guardSafetySessionResolvedInput,
  openSafetySessionStructuredStream,
  safetySessionMemoryWriteGuard,
  safetySessionModelIngressGuard,
  safetySessionToolDefinitionGuard,
  safetySessionToolDescriptionGuard,
} from "../../safety/session";
import { languageBindingApplicability } from "../../safety/language-applicability";
import type { LiveTextSlot } from "../../safety/output/completion";
import { orchestrateStream } from "../../generation/orchestrate";
import { runInStreamObservationContext } from "../../generation/stream-observability";
import { composeAbortSignals, withBudget } from "../../generation/timeout";
import { normalizeAdapterCallError } from "../normalized-outcome";
import { normalizeInvocationMessages } from "../../content/invocation-message";
import { assertProviderMediaSupported } from "../native-chat/media-hooks";
import type { CallArgs, StreamHandle } from "../types";
import {
  openCoordinatedStructuredStream,
  resolveCommitGates,
} from "./stream-coordinated-route";
import { createToolLifecycle } from "../tool/session";
import type { AdapterExecutionStreamArgs, CoreStepDialect } from "./types";
import { initialCoreMessageState } from "./messages";
import { createCachedStreamHandle } from "./metadata";
import { buildResolveOpts, DEFAULT_MAX_STEPS } from "./shared";
import { createSafetyTextChunk, isSafetyTextChunk } from "./stream-safety";
import { emitInputTokenEstimate } from "./media-token-budget";
import {
  guardStreamCompletion,
  trackSafetyStreamSeal,
} from "./stream-completion";
import { observe } from "../../observability";
import type { WithOperationResultMeta } from "../../observability";
import { materializeToolSources } from "./tool-sources";
import { createStreamSourceCleanup } from "./stream-source-cleanup";
import { trackRawStream } from "./stream-tracking";
import type { CruxRunId } from "../../observability";
import {
  compileStructuredOutputForRequest,
  CruxUnsupportedStructuredOutputError,
} from "../structured-output";
import type {
  JsonSchemaObject,
  StructuredOutputDecodeManifest,
} from "../structured-output";
import { withDefaultResolverPorts } from "../../resolver/ports";
import { attachCachedCandidateFinalizer } from "../../runtime/internal/cached-candidate-finalizer";
import { readCachedReleaseSeal } from "../../runtime/internal/cached-release-seal";
import { createCachedStreamCandidateFinalizer } from "./cached-stream-candidate";
import { sealRequest } from "../../request/planner/seal";
import { recordRequestRetryCount } from "../../request/receipt/receipt";

/**
 * Start one provider stream through the core-owned adapter dialect.
 *
 * The returned handle preserves the provider stream shape while interposing
 * Crux stream safety on text deltas and capturing the completed assistant turn
 * when `completion()` resolves.
 *
 * @param dialect - Normalized core-step dialect for one bound provider client.
 * @param args - Prepared streaming arguments from the public `adapter()` facade.
 * @returns A provider-compatible stream handle.
 */
export async function streamCore<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown>,
>(
  dialect: CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra>,
  args: AdapterExecutionStreamArgs<string, TExtra>,
): Promise<
  WithOperationResultMeta<StreamHandle<TRawStream>> &
    Readonly<{ runId: CruxRunId }>
> {
  const prompt = args.prompt;
  const modelInfo = args.modelInfo ?? {
    provider: args.provider ?? dialect.id,
    modelId: args.model,
  };
  const resolveOpts = buildResolveOpts({
    input: args.input,
    provider: args.provider ?? modelInfo.provider,
    modelId: modelInfo.modelId,
    settings: args.settings,
  });
  let resolved = await prompt.resolve(resolveOpts);
  const mappedSettings = dialect.mapSettings(resolved.settings);
  const initialMessages = initialCoreMessageState(resolved, args.messages);
  let messages = initialMessages.messages;
  let currentSystem = resolved.system;
  let currentSystemBlocks = resolved.systemBlocks;
  const safety = createSafetyWithBindingApplicability(
    {
      call: {
        constraints: args.constraints,
        guardrails: args.guardrails,
        constraintMaxRetries: args.constraintMaxRetries,
      },
      safety: args.safety,
      resolved: {
        constraints: resolved.constraints,
        guardrails: resolved.guardrails,
        metadata: resolved.metadata,
      },
      promptId: prompt.id,
      model: modelInfo.modelId,
      systemPrompt: resolved.system,
    },
    languageBindingApplicability(resolved.schema !== undefined),
  );
  const guardedInput = await guardSafetySessionResolvedInput(
    safety,
    resolved,
    {
      messages,
      system: currentSystem,
    },
    {
      resolvedMessages:
        initialMessages.source === "resolved-messages"
          ? "selected"
          : "discarded",
    },
  );
  messages = [...guardedInput.messages];
  if (guardedInput.system !== currentSystem) currentSystemBlocks = undefined;
  currentSystem = guardedInput.system;
  const sourceSession = await materializeToolSources({
    dialect: dialect.id,
    resolved,
    materialize: dialect.materializeToolSource,
    runtimeContext: args.runtimeContext,
    abortSignal: args.signal,
  });
  resolved = sourceSession.resolved;

  try {
    const lifecycle = createToolLifecycle({
      regime: "core",
      resolved,
      call: {
        tools: args.tools,
        toolsContext: args.toolsContext,
        runtimeContext: args.runtimeContext,
        toolMiddleware: args.toolMiddleware,
        toolApproval: args.toolApproval,
      },
      promptId: prompt.id,
      input: args.input ?? {},
      timeout: args.timeout,
      abortSignal: args.signal,
      modelIngress: safetySessionModelIngressGuard(safety, "tool"),
      memoryWriteGuard: safetySessionMemoryWriteGuard(safety),
      appendToolRound: dialect.appendToolRound,
      sanitizeToolSchema: dialect.sanitizeToolSchema,
      ...(dialect.structuredOutput
        ? { structuredOutputCapabilities: dialect.structuredOutput.accepts }
        : {}),
    });
    await lifecycle.guardExposure({
      root: safetySessionToolDefinitionGuard(safety),
      descriptions: safetySessionToolDescriptionGuard(safety),
    });
    const tools = lifecycle.descriptors
      ? [...lifecycle.descriptors]
      : undefined;
    messages = (await lifecycle.resume(messages)).messages;

    let outputSchema: JsonSchemaObject | undefined;
    let structuredDecodeManifest: StructuredOutputDecodeManifest | undefined;
    let structuredCanonicalSchema: JsonSchemaObject | undefined;
    if (resolved.schema) {
      if (!dialect.structuredOutput) {
        throw new CruxUnsupportedStructuredOutputError(dialect.id);
      }
      const plan = compileStructuredOutputForRequest(
        resolved.schema,
        dialect.structuredOutput.accepts,
        {
          diagnostics: withDefaultResolverPorts().diagnostics,
          promptId: prompt.id,
        },
      );
      outputSchema = plan.outputSchema;
      structuredDecodeManifest = plan.decodeManifest;
      structuredCanonicalSchema = plan.canonicalSchema;
    }
    const cachedFinalizer = resolved.schema
      ? createCachedStreamCandidateFinalizer({
          output: "object",
          safety,
          messages: () => messages,
          schema: resolved.schema,
          promptId: prompt.id ?? "unknown",
          structuredContext: {
            canonicalSchema: structuredCanonicalSchema!,
            decodeManifest: structuredDecodeManifest,
          },
        })
      : createCachedStreamCandidateFinalizer({
          output: "text",
          safety,
          messages: () => messages,
        });
    const providerMessages = await normalizeInvocationMessages(messages, {
      provider: modelInfo.provider,
    });
    assertProviderMediaSupported(
      { providerId: dialect.id, media: dialect.media },
      {
        provider: modelInfo.provider,
        model: modelInfo.modelId,
        messages: providerMessages,
      },
    );

    const callArgs: CallArgs<TExtra> = {
      model: modelInfo.modelId,
      system: currentSystem,
      systemBlocks: currentSystemBlocks,
      messages: providerMessages,
      settings: mappedSettings,
      schema: resolved.schema,
      outputSchema,
      tools,
      extra: (args.extra ?? {}) as TExtra,
    };
    const sealStreamRequest = (
      request: CallArgs<TExtra>,
      previousRequestId?: string,
    ) =>
      sealRequest({
        provider: modelInfo.provider,
        model: modelInfo.modelId,
        request,
        settings: resolved.settings,
        inputBudget: args.inputBudget,
        capacity: dialect.capacity,
        countTokens: dialect.countTokens
          ? (candidate) => dialect.countTokens!(dialect.client, candidate)
          : undefined,
        media: dialect.media,
        previousRequestId,
      });
    const sealed = await sealStreamRequest(callArgs);

    // Resolved BEFORE the provider stream is observed: `token.chunk` telemetry must
    // know whether these deltas belong to an attempt a gate can still discard.
    const gates = resolveCommitGates(
      safety,
      resolved.schema !== undefined,
      args.validationRetry?.maxRetries,
    );

    // `result.cancel()` must reach the provider, not merely detach readers. The
    // caller's own signal already flows into the call; this controller gives the
    // published result the same authority without inventing a second one.
    const cancellation = new AbortController();
    const callerSignal = composeAbortSignals(args.signal, cancellation.signal);

    let providerRawStream: TRawStream | undefined;
    const handle = await sourceSession.withContext(() =>
      orchestrateStream(
        attachCachedCandidateFinalizer(
          {
            discardableAttempt: gates.coordinated,
            promptId: prompt.id,
            promptConfig: prompt.config ?? ({} as typeof prompt.config),
            preparedArgs: { ...callArgs, input: args.input ?? {} },
            input: args.input ?? {},
            provider: modelInfo.provider,
            model: modelInfo.modelId,
            resolved,
            outputMode: resolved.schema ? "object" : "text",
            timeout: args.timeout,
            createCachedStreamResult: (cached) =>
              createCachedStreamHandle(cached) as unknown as MiddlewareResult,
          },
          cachedFinalizer,
        ),
        async () => {
          emitInputTokenEstimate({
            messages: providerMessages,
            provider: modelInfo.provider,
            model: modelInfo.modelId,
            media: dialect.media,
          });
          const providerHandle = await withBudget(
            (signal) =>
              dialect.stream(dialect.client, sealed.request, {
                signal: composeAbortSignals(callerSignal, signal),
              }),
            {
              budget: "step",
              limitMs: args.timeout?.stepMs,
            },
          ).catch((error: unknown) => {
            throw normalizeAdapterCallError(error, {
              providerId: modelInfo.provider,
              signal: args.signal,
              mapError: dialect.mapError,
            });
          });
          providerRawStream = providerHandle.raw ?? providerHandle.rawStream;
          return {
            ...providerHandle,
            completion: async () => {
              const completion = await providerHandle.completion();
              recordRequestRetryCount(
                sealed.receipt,
                completion?.transportRetries,
              );
              return {
                ...completion,
                request: sealed.receipt,
              };
            },
          };
        },
      ),
    );

    const closeSources = createStreamSourceCleanup(sourceSession, args.signal);
    const cachedRelease = readCachedReleaseSeal(handle);

    // A live enforce `assert` commit gate on a structured stream can reject an
    // attempt (RFC #173). Route it through the coordinated route so a rejected
    // attempt is discarded and restreamed (buffer-until-commitment: no leaked
    // bytes) — while any stream with no commit gate keeps the byte-for-byte
    // progressive path below unchanged.
    if (gates.coordinated && !cachedRelease) {
      return {
        ...openCoordinatedStructuredStream(
          {
            dialect,
            handle,
            providerRawStream,
            callArgs,
            initialRequest: sealed.receipt,
            sealAttempt: sealStreamRequest,
            safety,
            ...(resolved.schema ? { schema: resolved.schema } : {}),
            messages,
            promptId: prompt.id,
            modelInfo,
            maxSteps:
              args.maxSteps ?? resolved.settings.maxSteps ?? DEFAULT_MAX_STEPS,
            ...(callerSignal ? { signal: callerSignal } : {}),
            ...(args.timeout?.stepMs != null
              ? { stepTimeoutMs: args.timeout.stepMs }
              : {}),
            ...(args.validationRetry
              ? { validationRetry: args.validationRetry }
              : {}),
            ...(structuredCanonicalSchema ? { structuredCanonicalSchema } : {}),
            ...(structuredDecodeManifest ? { structuredDecodeManifest } : {}),
            closeSources,
            captureTurn: (turn) =>
              lifecycle.captureTurn({
                messages: [...turn.messages],
                assistantText: turn.assistantText,
                toolCalls: turn.toolCalls as never,
              }),
          },
          gates.validationGate,
        ),
        _meta: handle._meta,
        runId: handle.runId,
        structured: resolved.schema !== undefined,
        abort: (reason: unknown) => cancellation.abort(reason),
        ...(callerSignal ? { signal: callerSignal } : {}),
      } as WithOperationResultMeta<StreamHandle<TRawStream>> &
        Readonly<{ runId: CruxRunId }>;
    }

    // Structured output drives the scanner-fed occurrence stream (progressive
    // object gating + release cursor); plain text uses the text stream.
    //
    // A structured stream is opened even when Safety has no applicable policy, as
    // long as the decode manifest has work to do: canonicalization is what turns
    // provider wire JSON into `z.input`, and `textStream`/`partialOutputStream`
    // must never carry a lowering sentinel. Gating this on `safety.enabled` alone
    // published raw wire JSON — including sentinel nulls the manifest deletes —
    // for an unguarded structured prompt (RFC #173).
    const canonicalizes =
      (structuredDecodeManifest?.operations.length ?? 0) > 0;
    const trackedSafety = cachedRelease
      ? undefined
      : resolved.schema && (safety.enabled || canonicalizes)
        ? trackSafetyStreamSeal(
            openSafetySessionStructuredStream(safety, {
              ...(structuredCanonicalSchema
                ? { canonicalSchema: structuredCanonicalSchema }
                : {}),
              ...(structuredDecodeManifest
                ? { decodeManifest: structuredDecodeManifest }
                : {}),
            }),
          )
        : safety.enabled
          ? trackSafetyStreamSeal(safety.openStream())
          : undefined;
    const streamedAssistant: {
      text: string;
      providerText: string;
      exactSlots: boolean;
      slots: LiveTextSlot[];
    } = { text: "", providerText: "", exactSlots: true, slots: [] };

    return {
      ...handle,
      structured: resolved.schema !== undefined,
      abort: (reason: unknown) => cancellation.abort(reason),
      ...(callerSignal ? { signal: callerSignal } : {}),
      raw: handle.raw ?? providerRawStream ?? handle.rawStream,
      rawStream: trackRawStream<TRawStream>({
        rawStream: handle.rawStream as AsyncIterable<unknown>,
        extractTextDelta: handle.extractTextDelta,
        safetyStream: trackedSafety?.stream,
        observeText: (text) => {
          streamedAssistant.providerText += text;
        },
        appendText: (text) => {
          streamedAssistant.text += text;
        },
        recordText: (providerText, guardedText, directive) => {
          if (directive === "hold") streamedAssistant.exactSlots = false;
          streamedAssistant.slots.push({ providerText, guardedText });
        },
        close: closeSources,
      }),
      extractTextDelta: (chunk: unknown) =>
        isSafetyTextChunk(chunk) ? chunk.text : handle.extractTextDelta(chunk),
      completion: async () => {
        try {
          const meta = await handle.completion();
          const liveText =
            trackedSafety?.sealedText() ??
            (streamedAssistant.providerText
              ? streamedAssistant.text
              : undefined);
          const liveTextSlots =
            trackedSafety &&
            streamedAssistant.exactSlots &&
            streamedAssistant.slots
              .map((slot) => slot.providerText)
              .join("") === streamedAssistant.providerText &&
            streamedAssistant.slots.map((slot) => slot.guardedText).join("") ===
              liveText
              ? streamedAssistant.slots
              : undefined;
          const guarded = await guardStreamCompletion({
            safety,
            meta,
            assembleWithoutSafety: true,
            ...(cachedRelease ? { cachedRelease } : {}),
            liveText,
            representedText: streamedAssistant.providerText || undefined,
            liveTextSlots,
            messages,
            ...(resolved.schema
              ? {
                  schema: resolved.schema,
                  decodeManifest: structuredDecodeManifest,
                  ...(structuredCanonicalSchema
                    ? {
                        structuredContext: {
                          canonicalSchema: structuredCanonicalSchema,
                          decodeManifest: structuredDecodeManifest,
                        },
                      }
                    : {}),
                  // The live structured stream already object-gated + sealed the
                  // canonical value: consume it directly (no re-decode/re-gate).
                  ...(trackedSafety?.sealed()
                    ? {
                        sealedCanonicalValue: trackedSafety.sealedObject(),
                        objectOccurrencesAlreadyGated: true,
                      }
                    : {}),
                  promptId: prompt.id,
                }
              : {}),
          });
          await runInStreamObservationContext(handle, () =>
            lifecycle.captureTurn({
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
  } catch (error) {
    await sourceSession.close();
    throw error;
  }
}
