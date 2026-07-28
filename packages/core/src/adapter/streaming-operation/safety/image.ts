import type { ImageStreamEvent } from "../../../generation/image-stream-contracts";
import type { MediaPartSubject } from "../../../safety/boundary";
import {
  guardSafetySessionOutputMedia,
  type Safety,
} from "../../../safety/session";
import { streamingMediaGuardContext } from "./context";

export type ImageStreamCandidate = Exclude<
  ImageStreamEvent,
  { readonly type: "start" | "image" | "finish" }
>;

/**
 * Guard a complete image preview before publication.
 *
 * Incomplete deltas and final images belong to the terminal coordinator and
 * pass through untouched here. A stripped preview returns `undefined`; later
 * occurrences remain independently eligible for publication.
 */
export async function guardImageStreamCandidate(
  event: ImageStreamCandidate,
  safety: Safety | undefined,
  model?: string,
): Promise<ImageStreamCandidate | undefined> {
  if (!safety || event.type !== "image-preview") return event;
  const subject = previewSubject(event);
  const guarded = await guardSafetySessionOutputMedia(safety, [subject], {
    minimumRetained: 0,
    model,
    stream: streamingMediaGuardContext(
      "preview",
      event.outputIndex,
      event.sequence,
    ),
  });
  return guarded.subjects.length === 0 ? undefined : event;
}

function previewSubject(
  event: Extract<ImageStreamCandidate, { readonly type: "image-preview" }>,
): MediaPartSubject {
  return Object.freeze({
    part: Object.freeze({
      type: "image" as const,
      source: event.image,
      ...(event.image.mediaType === undefined
        ? {}
        : { mediaType: event.image.mediaType }),
    }),
    origin: Object.freeze({
      kind: "operation" as const,
      operation: "streamImage" as const,
      phase: "preview" as const,
      field: "images" as const,
      outputIndex: event.outputIndex,
      sequence: event.sequence,
    }),
  });
}
