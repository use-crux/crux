import type { Asset } from "../../asset/types";
import type { StreamingEventDescriptor } from "./observability";

/**
 * Project a canonical event into payload-free progress facts.
 *
 * This projection stays outside observability so telemetry code never receives
 * the event or asset object. It reads only media type and already-known size;
 * it never hashes, encodes, fetches, or copies media.
 */
export function describeStreamingEvent(
  event: unknown,
): StreamingEventDescriptor | undefined {
  if (!isRecord(event) || typeof event.type !== "string") return undefined;
  switch (event.type) {
    case "image-preview":
      return assetDescriptor("preview", event.image);
    case "image-delta":
    case "audio-delta":
      return {
        kind: "delta",
        byteCount: event.data instanceof Uint8Array ? event.data.byteLength : 0,
        ...(typeof event.mediaType === "string"
          ? { mediaType: event.mediaType }
          : {}),
      };
    case "image":
      return assetDescriptor("final", event.image);
    case "audio":
      return assetDescriptor("final", event.audio);
    default:
      return undefined;
  }
}

function assetDescriptor(
  kind: "preview" | "final",
  value: unknown,
): StreamingEventDescriptor {
  if (!isRecord(value)) return { kind, byteCount: 0 };
  const asset = value as Asset;
  const knownSize =
    typeof asset.size === "number" && Number.isFinite(asset.size)
      ? Math.max(0, asset.size)
      : asset.type === "data"
        ? asset.data instanceof Uint8Array
          ? asset.data.byteLength
          : asset.data.size
        : 0;
  return {
    kind,
    byteCount: knownSize,
    ...(typeof asset.mediaType === "string"
      ? { mediaType: asset.mediaType }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
