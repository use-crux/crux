/**
 * Closed authored-media operation vocabulary and presentation semantics.
 *
 * Keeping delivery framing here prevents Catalog cards from conflating Core's
 * bounded image/speech streams with the unbounded text `stream()` operation.
 */

/** Operations admitted from safe Project Index media facts. */
export const MEDIA_OPERATION_NAMES = [
  "generate",
  "stream",
  "generateImage",
  "streamImage",
  "transcribe",
  "generateSpeech",
  "streamSpeech",
  "describe",
] as const;

/** A known authored media operation. */
export type MediaOperationName = (typeof MEDIA_OPERATION_NAMES)[number];

const mediaOperationNames = new Set<string>(MEDIA_OPERATION_NAMES);

/** Narrow an untrusted Project Index value to the closed operation union. */
export function isMediaOperationName(
  value: string | undefined,
): value is MediaOperationName {
  return value !== undefined && mediaOperationNames.has(value);
}

/**
 * Return an explicit delivery badge for streaming operations.
 *
 * Completed operations need no extra framing; their operation badge is
 * already unambiguous.
 */
export function mediaOperationDeliveryBadge(
  operation: MediaOperationName | "unknown",
): "bounded media stream" | "text stream" | undefined {
  if (operation === "streamImage" || operation === "streamSpeech") {
    return "bounded media stream";
  }
  return operation === "stream" ? "text stream" : undefined;
}
