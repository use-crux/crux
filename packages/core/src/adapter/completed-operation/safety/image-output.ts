import type { Asset } from "../../../asset/types";
import type { CompletedOperationProviderPayload } from "../../../completed-operation/contracts";
import type { MediaPartSubject } from "../../../safety/boundary";
import { freezeSafetyAudit, hasSafetyAudit } from "../../../safety/audit";
import { SafetyResultError } from "../../../safety/errors";
import {
  guardSafetySessionOutputMedia,
  type Safety,
} from "../../../safety/session";
import type { GuardrailContext } from "../../../safety/guardrail/types";

type GeneratedImageResult = CompletedOperationProviderPayload &
  Readonly<{
    readonly images: readonly [Asset, ...Asset[]];
    readonly image: Asset;
  }>;

export interface GuardedGeneratedImages<
  TResult extends CompletedOperationProviderPayload,
> {
  readonly result: TResult;
  readonly retained: readonly Readonly<{
    image: Asset;
    outputIndex: number;
  }>[];
}

/** Guard generated images and write retained canonical assets back immutably. */
export async function guardGeneratedImageOutput<
  TResult extends CompletedOperationProviderPayload,
>(result: TResult, safety: Safety, model?: string): Promise<TResult> {
  return (await guardGeneratedImageOutputSelection(result, safety, model))
    .result;
}

/** Guard images while retaining their original provider output indexes. */
export async function guardGeneratedImageOutputSelection<
  TResult extends CompletedOperationProviderPayload,
>(
  result: TResult,
  safety: Safety,
  model?: string,
  operation: "generateImage" | "streamImage" = "generateImage",
  stream?:
    | GuardrailContext["stream"]
    | ((subject: MediaPartSubject) => GuardrailContext["stream"]),
): Promise<GuardedGeneratedImages<TResult>> {
  if (!isGeneratedImageResult(result)) {
    throw new SafetyResultError({
      message:
        "Completed generateImage Safety requires a non-empty canonical images result.",
      policyId: "completed-operation",
      boundary: "model.output.media",
      problem: "generateImage result has no non-empty images tuple",
    });
  }

  const projected = result.images.map((image, partIndex) => ({
    image,
    outputIndex: partIndex,
    subject: imageSubject(image, partIndex, operation),
  }));
  const guarded = await guardSafetySessionOutputMedia(
    safety,
    projected.map(({ subject }) => subject),
    { minimumRetained: 1, model, stream },
  );
  const retained = new Set(guarded.subjects);
  const retainedImages = projected.filter(({ subject }) =>
    retained.has(subject),
  );
  const images = retainedImages.map(({ image }) => image);
  const [image, ...rest] = images;
  if (!image) {
    throw new SafetyResultError({
      message:
        "Completed generateImage Safety cannot expose an empty images result.",
      policyId: "completed-operation",
      boundary: "model.output.media",
      problem: "guarded image result is empty",
    });
  }
  const changed = images.length !== result.images.length;
  const audit = safety.audit;
  if (!changed && !hasSafetyAudit(audit)) {
    return {
      result,
      retained: retainedImages.map(({ image, outputIndex }) => ({
        image,
        outputIndex,
      })),
    };
  }

  const nonEmpty: readonly [Asset, ...Asset[]] = [image, ...rest];
  return {
    result: Object.freeze({
      ...result,
      ...(changed ? { image, images: Object.freeze(nonEmpty) } : {}),
      ...(hasSafetyAudit(audit) ? { safety: freezeSafetyAudit(audit) } : {}),
    }),
    retained: retainedImages.map(({ image: retained, outputIndex }) => ({
      image: retained,
      outputIndex,
    })),
  };
}

function imageSubject(
  image: Asset,
  outputIndex: number,
  operation: "generateImage" | "streamImage",
): MediaPartSubject {
  return Object.freeze({
    part: Object.freeze({
      type: "image" as const,
      source: image,
      ...(image.mediaType === undefined ? {} : { mediaType: image.mediaType }),
    }),
    origin: Object.freeze(
      operation === "generateImage"
        ? {
            kind: "operation" as const,
            operation,
            phase: "output" as const,
            field: "images" as const,
            partIndex: outputIndex,
          }
        : {
            kind: "operation" as const,
            operation,
            phase: "final" as const,
            field: "images" as const,
            outputIndex,
          },
    ),
  });
}

function isGeneratedImageResult(
  result: CompletedOperationProviderPayload,
): result is GeneratedImageResult {
  return (
    "images" in result &&
    Array.isArray(result.images) &&
    result.images.length > 0 &&
    "image" in result
  );
}
