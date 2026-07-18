/**
 * `createAiSdkLoopRuntime()` — the `LoopRuntimePort` implementation for the
 * Vercel AI SDK.
 *
 * Core owns policy: prompt resolution, routing, validation retry, tool
 * approval tokens, safety policy, timeouts, and observability. This runtime
 * owns only the gateway invocation. The internal SDK codec plans AI SDK calls
 * and projects raw SDK results back into core contracts; the runtime closes
 * over the {@link SdkGateway} so each port method takes only a request.
 *
 * @module
 */

import type { LanguageModel } from "ai";
import { normalizeAdapterCallError } from "@use-crux/core/adapter";
import type { ExecutorRequest, LoopRuntimePort } from "@use-crux/core/adapter";
import { isPolicyTerminal } from "@use-crux/core/safety";
import type { SdkGateway } from "./gateway";
import { mapAiSdkError } from "./normalized-outcome";
import { createAiSdkCodec } from "./sdk-codec";
import type { SdkLoopResultLike, SdkStreamResultLike } from "./sdk-codec";
import { materializeAiSdkToolSource } from "./mcp-materializer";

export type { SdkLoopResultLike, SdkStreamResultLike } from "./sdk-codec";

/** The AI SDK loop runtime port, bound to one {@link SdkGateway}. */
export type AiSdkLoopRuntime = LoopRuntimePort<
  LanguageModel,
  SdkLoopResultLike,
  SdkStreamResultLike
>;

/**
 * Build the AI SDK {@link LoopRuntimePort} over a concrete {@link SdkGateway}.
 *
 * The gateway is the package's external seam: production binds
 * `liveSdkGateway()`, tests bind a scripted gateway. The returned port is what
 * `aiSdkProviderRuntime` and `createCruxAi({ gateway })` drive.
 *
 * @param gateway - The AI SDK gateway to invoke (`generateText`/`generateObject`/
 *   `streamText`/`streamObject`).
 * @returns A loop runtime port bound to the gateway.
 */
export function createAiSdkLoopRuntime(gateway: SdkGateway): AiSdkLoopRuntime {
  const codec = createAiSdkCodec();

  return {
    id: codec.executorId,
    capabilities: { stepTransform: "before-client-tools" },

    materializeToolSource: materializeAiSdkToolSource,

    describeModel: codec.describeModel,

    mapSettings: codec.mapSettings,

    async runTextLoop(request) {
      const call = codec.loop(request);
      const raw = await runCall(() => gateway[call.method](call.args), request);
      return call.decode(raw);
    },

    async runStructuredAttempt(request) {
      const call = await codec.structured(request);
      try {
        return call.method === "generateObject"
          ? call.decode(await gateway.generateObject(call.args))
          : call.decode(await gateway.generateText(call.args));
      } catch (error) {
        const invalid = await call.decodeError(error);
        if (invalid) return invalid;
        if (isPolicyTerminal(error)) throw error;
        throw normalize(error, request);
      }
    },

    async runStream(request) {
      const call = await codec.stream(request);
      return runCall(
        () =>
          call.method === "streamText"
            ? call.attach(gateway.streamText(call.args))
            : call.attach(gateway.streamObject(call.args)),
        request,
      );
    },

    replayStream: codec.replayStream,
  };
}

/**
 * Run one gateway call, normalizing any thrown provider/transport error into a
 * `CruxAdapterError` at the `LoopRuntimePort` boundary. Core's loop-owned
 * generate/stream path does not classify these itself (unlike the native
 * single-turn path), so this is where AI SDK failures join the shared taxonomy.
 */
async function runCall<T>(
  run: () => T | Promise<T>,
  request: ExecutorRequest<LanguageModel>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isPolicyTerminal(error)) throw error;
    throw normalize(error, request);
  }
}

/** Classify a thrown AI SDK call error via core's shared normalization path. */
function normalize(
  error: unknown,
  request: ExecutorRequest<LanguageModel>,
): unknown {
  return normalizeAdapterCallError(error, {
    providerId: "ai-sdk",
    signal: request.abortSignal,
    mapError: mapAiSdkError,
  });
}
