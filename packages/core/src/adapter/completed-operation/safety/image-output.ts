import type { Asset } from "../../../asset/types";
import type { CompletedOperationResult } from "../../../completed-operation/contracts";
import type { MediaPartSubject } from "../../../safety/boundary";
import { freezeSafetyAudit, hasSafetyAudit } from "../../../safety/audit";
import { SafetyResultError } from "../../../safety/errors";
import {
  guardSafetySessionOutputMedia,
  type Safety,
} from "../../../safety/session";

type GeneratedImageResult = CompletedOperationResult &
  Readonly<{
    readonly images: readonly [Asset, ...Asset[]];
    readonly image: Asset;
  }>;

/** Guard generated images and write retained canonical assets back immutably. */
export async function guardGeneratedImageOutput<
  TResult extends CompletedOperationResult,
>(result: TResult, safety: Safety): Promise<TResult> {
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
    subject: imageSubject(image, partIndex),
  }));
  const guarded = await guardSafetySessionOutputMedia(
    safety,
    projected.map(({ subject }) => subject),
    { minimumRetained: 1 },
  );
  const retained = new Set(guarded.subjects);
  const images = projected
    .filter(({ subject }) => retained.has(subject))
    .map(({ image }) => image);
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
  if (!changed && !hasSafetyAudit(audit)) return result;

  const nonEmpty: readonly [Asset, ...Asset[]] = [image, ...rest];
  return Object.freeze({
    ...result,
    ...(changed ? { image, images: Object.freeze(nonEmpty) } : {}),
    ...(hasSafetyAudit(audit) ? { safety: freezeSafetyAudit(audit) } : {}),
  });
}

function imageSubject(image: Asset, partIndex: number): MediaPartSubject {
  return Object.freeze({
    part: Object.freeze({
      type: "image" as const,
      source: image,
      ...(image.mediaType === undefined ? {} : { mediaType: image.mediaType }),
    }),
    origin: Object.freeze({
      kind: "operation" as const,
      operation: "generateImage" as const,
      phase: "output" as const,
      field: "images" as const,
      partIndex,
    }),
  });
}

function isGeneratedImageResult(
  result: CompletedOperationResult,
): result is GeneratedImageResult {
  return (
    "images" in result &&
    Array.isArray(result.images) &&
    result.images.length > 0 &&
    "image" in result
  );
}
