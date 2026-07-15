/**
 * Node-only AI SDK transcription with secure HTTPS audio materialization.
 *
 * Import this subpath when an HTTPS audio source must be downloaded by Crux.
 * The package root remains portable and accepts already-materialized audio.
 *
 * @module
 */

import { downloadAudio } from "@use-crux/core/transcription/node";
import { liveSdkGateway, type SdkGateway } from "../gateway";
import {
  createAiSdkTranscribe as createInternalAiSdkTranscribe,
  type AITranscribe,
} from "../transcription";

export type {
  AITranscribe,
  AITranscriptionExtra,
  AITranscriptionMetadata,
} from "../transcription";

/**
 * Create a Node transcription operation bound to an injectable AI SDK gateway.
 *
 * HTTPS sources use Crux's bounded, DNS-pinned downloader before the gateway
 * sends provider I/O. Already-materialized sources follow the same shared
 * validation and result-mapping path as the portable package root.
 */
export function createAiSdkTranscribe(gateway: SdkGateway): AITranscribe {
  return createInternalAiSdkTranscribe(gateway, async (input) => {
    const asset = await downloadAudio(input.url, {
      signal: input.abortSignal,
    });
    return { data: asset.data as Uint8Array, mediaType: asset.mediaType };
  });
}

/** Default live AI SDK transcription with secure Node URL materialization. */
export const transcribe: AITranscribe = createAiSdkTranscribe(liveSdkGateway());
