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

const OPERATION_ALIASES = {
  generateImage: "media.generate_image",
  "image.generate": "media.generate_image",
  "media.generate_image": "media.generate_image",
  generate_image: "media.generate_image",
  image: "media.generate_image",
  transcribe: "media.transcribe",
  "audio.transcribe": "media.transcribe",
  "media.transcribe": "media.transcribe",
  generateSpeech: "media.generate_speech",
  "generate_speech": "media.generate_speech",
  "audio.speech": "media.generate_speech",
  "generation.speech": "media.generate_speech",
  "media.generate_speech": "media.generate_speech",
  speech: "media.generate_speech",
  describe: "media.describe",
  "media.describe": "media.describe",
} as const satisfies Readonly<Record<string, MediaPrimitiveName>>;

/**
 * Exact binding names whose shared runner guarantees a Core-owned media span.
 *
 * The union is derived from the runtime table so public result typing and
 * runtime observation cannot disagree. Custom, normalized, or widened strings
 * remain payload-only until explicitly added to this vocabulary.
 */
export type CompletedMediaOperationName = keyof typeof OPERATION_ALIASES;

/**
 * Resolve the media primitive for a completed-operation binding name.
 *
 * Unknown or merely normalized names remain non-media. Adding an alias is an
 * ownership decision and must update this single runtime/type vocabulary.
 */
export function mediaPrimitiveForOperation(
  operation: string,
): MediaPrimitiveName | undefined {
  return Object.hasOwn(OPERATION_ALIASES, operation)
    ? OPERATION_ALIASES[operation as CompletedMediaOperationName]
    : undefined;
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
