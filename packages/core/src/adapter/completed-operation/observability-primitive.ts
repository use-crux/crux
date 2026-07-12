/**
 * Map completed-operation public names onto the canonical media observability
 * vocabulary.
 *
 * Provider packages bind operations under adapter-facing names such as
 * `generateImage` or `transcribe`. Observability always records the four
 * closed media primitives so Catalog, Runs, and OTel share one graph language.
 *
 * @module
 * @internal
 */

import {
  CRUX_PRIMITIVE_NAMES,
  type CruxPrimitiveName,
} from "../../observability/contract";

const MEDIA_PRIMITIVES = [
  "media.generate_image",
  "media.transcribe",
  "media.generate_speech",
  "media.describe",
] as const satisfies readonly CruxPrimitiveName[];

export type MediaPrimitiveName = (typeof MEDIA_PRIMITIVES)[number];

const OPERATION_ALIASES: Readonly<Record<string, MediaPrimitiveName>> = {
  generateimage: "media.generate_image",
  "image.generate": "media.generate_image",
  "media.generate_image": "media.generate_image",
  generate_image: "media.generate_image",
  image: "media.generate_image",
  transcribe: "media.transcribe",
  "audio.transcribe": "media.transcribe",
  "media.transcribe": "media.transcribe",
  generatespeech: "media.generate_speech",
  "generate_speech": "media.generate_speech",
  "audio.speech": "media.generate_speech",
  "generation.speech": "media.generate_speech",
  "media.generate_speech": "media.generate_speech",
  speech: "media.generate_speech",
  describe: "media.describe",
  "media.describe": "media.describe",
};

/**
 * Resolve the media primitive for a completed-operation binding name.
 *
 * Unknown names fall back to `media.describe` only when they clearly describe
 * media; otherwise the caller should treat the operation as non-media.
 */
export function mediaPrimitiveForOperation(
  operation: string,
): MediaPrimitiveName | undefined {
  const normalized = operation.trim().toLowerCase().replace(/[\s-]+/g, "");
  const dotted = operation.trim().toLowerCase();
  return (
    OPERATION_ALIASES[dotted] ??
    OPERATION_ALIASES[normalized] ??
    (MEDIA_PRIMITIVES.includes(dotted as MediaPrimitiveName)
      ? (dotted as MediaPrimitiveName)
      : undefined)
  );
}

/** Return whether `name` is a registered Crux primitive. */
export function isCruxPrimitiveName(name: string): name is CruxPrimitiveName {
  return (CRUX_PRIMITIVE_NAMES as readonly string[]).includes(name);
}

/** Human-readable span name: `{operation} {model}` when a model id is known. */
export function mediaSpanName(
  primitive: MediaPrimitiveName,
  model: unknown,
): string {
  const operation = primitive.slice("media.".length);
  const modelId = describeModelId(model);
  return modelId ? `${operation} ${modelId}` : operation;
}

function describeModelId(model: unknown): string | undefined {
  if (typeof model === "string" && model.trim()) return model.trim();
  if (typeof model === "object" && model !== null) {
    const record = model as { readonly modelId?: unknown; readonly id?: unknown };
    if (typeof record.modelId === "string" && record.modelId.trim())
      return record.modelId.trim();
    if (typeof record.id === "string" && record.id.trim()) return record.id.trim();
  }
  return undefined;
}
