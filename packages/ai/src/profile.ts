/**
 * AI SDK provider runtime.
 *
 * @module
 */

import {
  defineProviderRuntime,
  toolModelIngressDialect,
} from "@use-crux/core/adapter";
import { createAiSdkLoopRuntime } from "./executor";
import { createAiSdkRuntimeExtensions } from "./extensions";
import type { SdkGateway } from "./gateway";
import {
  aiSdkStructuredCapabilities,
  extractModelInfo,
} from "./provider-profile";
import { mapAiSdkSettings } from "./sdk-codec";
import { aiSdkMediaHooks } from "./media-preflight";
import { aiSdkModelCapacity } from "./capacity";
import { createAiSdkImageOperation } from "./image-generation";
import { createAiSdkTranscriptionOperation } from "./transcription";
import { createAiSdkSpeechOperation } from "./speech";

/**
 * Public provider runtime for the Vercel AI SDK.
 *
 * The AI SDK owns the multi-step language-model loop; Crux owns policy around
 * it through the loop-owned provider runtime boundary. This keeps AI SDK model
 * objects as first-class Crux provider models without importing the SDK into
 * `@use-crux/core`. `bind` closes over the gateway and exposes the
 * client-dependent loop operations; core assembles them into a `LoopRuntimePort`.
 */
export const aiSdkProviderRuntime = defineProviderRuntime({
  id: "ai-sdk",
  ownership: "loop-owned",
  loop: {
    describeModel: extractModelInfo,
    capacity: aiSdkModelCapacity,
    settings: mapAiSdkSettings,
    media: aiSdkMediaHooks,
    structuredOutput: { capabilities: aiSdkStructuredCapabilities },
    bind: (gateway: SdkGateway) => {
      const runtime = createAiSdkLoopRuntime(gateway);
      const {
        capabilities,
        compactHistory,
        materializeToolSource,
        runTextLoop,
        runStructuredAttempt,
        runStream,
        replayStream,
      } = runtime;
      return {
        capabilities,
        compactHistory,
        materializeToolSource,
        [toolModelIngressDialect]: runtime[toolModelIngressDialect],
        runTextLoop,
        runStructuredAttempt,
        runStream,
        replayStream,
      };
    },
  },
  image: createAiSdkImageOperation,
  transcription: createAiSdkTranscriptionOperation,
  speech: createAiSdkSpeechOperation,
  extend: ({ client }) => createAiSdkRuntimeExtensions(client),
});
