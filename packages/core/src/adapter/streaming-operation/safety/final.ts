import type { Asset, DataAsset } from "../../../asset/types";
import type { CompletedOperationProviderPayload } from "../../../completed-operation/contracts";
import type { ImageStreamEvent } from "../../../generation/image-stream-contracts";
import type { SpeechStreamEvent } from "../../../speech/stream-contracts";
import type { Safety } from "../../../safety/session";
import { guardGeneratedImageOutputSelection } from "../../completed-operation/safety/image-output";
import { guardGeneratedSpeechOutput } from "../../completed-operation/safety/speech";
import { streamingMediaGuardContext } from "./context";

export type StreamingFinalEvent =
  | Extract<ImageStreamEvent, { readonly type: "image" }>
  | Extract<SpeechStreamEvent, { readonly type: "audio" }>;

/** Final guarded payload plus canonical final events ready for publication. */
export interface FinalizedStreamingOutput<
  TResult extends CompletedOperationProviderPayload,
> {
  readonly result: TResult;
  readonly events: readonly StreamingFinalEvent[];
}

/** Reuse completed-media output Safety and preserve original output indexes. */
export async function finalizeStreamingOutput<
  TResult extends CompletedOperationProviderPayload,
>(
  operation: "streamImage" | "streamSpeech",
  result: TResult,
  safety: Safety | undefined,
  model?: string,
): Promise<FinalizedStreamingOutput<TResult>> {
  if (operation === "streamImage") {
    const original = imageEntries(result);
    const guarded = safety
      ? await guardGeneratedImageOutputSelection(
          result,
          safety,
          model,
          "streamImage",
          (subject) =>
            streamingMediaGuardContext(
              "final",
              subject.origin.kind === "operation" &&
                subject.origin.operation === "streamImage"
                ? subject.origin.outputIndex
                : 0,
            ),
        )
      : { result, retained: original };
    return {
      result: guarded.result,
      events: guarded.retained.map(({ image, outputIndex }) =>
        Object.freeze({ type: "image" as const, image, outputIndex }),
      ),
    };
  }

  const audio = speechAudio(result);
  const guarded = safety
    ? await guardGeneratedSpeechOutput(
        result,
        safety,
        model,
        "streamSpeech",
        streamingMediaGuardContext("final", 0),
      )
    : result;
  return {
    result: guarded,
    events: [Object.freeze({ type: "audio", audio })],
  };
}

function imageEntries(
  result: CompletedOperationProviderPayload,
): readonly Readonly<{ image: Asset; outputIndex: number }>[] {
  if (
    !("images" in result) ||
    !Array.isArray(result.images) ||
    result.images.length === 0
  ) {
    throw new TypeError("streamImage validation must return canonical images.");
  }
  return (result.images as readonly Asset[]).map((image, outputIndex) => ({
    image,
    outputIndex,
  }));
}

function speechAudio(result: CompletedOperationProviderPayload): DataAsset {
  if (!("audio" in result)) {
    throw new TypeError("streamSpeech validation must return canonical audio.");
  }
  return result.audio as DataAsset;
}
