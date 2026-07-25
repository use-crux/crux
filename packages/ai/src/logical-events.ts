/**
 * Translate AI SDK stream parts into Crux logical events (RFC #173).
 *
 * The AI SDK's part protocol is a PHYSICAL one: it frames provider steps, opens
 * and closes text blocks, streams unfinished tool-input JSON, and re-emits raw
 * provider chunks. None of that is public in a Crux logical stream, so this is
 * the boundary where physical framing stops.
 *
 * Everything not in the closed logical vocabulary is dropped rather than passed
 * through, which is what keeps "one logical `start`, one logical `finish`, no
 * provider step frames" true across a retry: the seam owns framing, and this
 * mapper never produces any.
 *
 * @internal
 * @module
 */

import type { PublishedStreamEvent, StreamSource } from "@use-crux/core/adapter";
import type { ContentPart } from "@use-crux/core";
import { decodeContentFromAiSdkParts } from "./content-parts";

/** Minimal structural view of an AI SDK stream part. */
interface SdkPart {
  readonly type?: unknown;
  readonly [key: string]: unknown;
}

/**
 * Map one AI SDK part onto the logical vocabulary.
 *
 * @returns The logical events this part produces, which is usually zero or one.
 * @throws The part's error when the SDK reports a terminal stream failure, so the
 *   publication seam fails every surface with one normalized identity instead of
 *   publishing an error event the contract does not define.
 */
export function logicalEventsFor<TPartial>(
  part: unknown,
): readonly PublishedStreamEvent<TPartial>[] {
  const sdk = (part ?? {}) as SdkPart;
  switch (sdk.type) {
    case "text-delta": {
      const text = typeof sdk.text === "string" ? sdk.text : undefined;
      return text ? [{ type: "text-delta", text }] : [];
    }
    case "reasoning-delta": {
      const text = typeof sdk.text === "string" ? sdk.text : undefined;
      return text ? [{ type: "reasoning-delta", text }] : [];
    }
    case "tool-call": {
      const call = toolIdentity(sdk);
      return call ? [{ ...call, type: "tool-call", input: sdk.input }] : [];
    }
    case "tool-result": {
      const call = toolIdentity(sdk);
      return call ? [{ ...call, type: "tool-result", output: sdk.output }] : [];
    }
    case "tool-error": {
      const call = toolIdentity(sdk);
      return call
        ? [{ ...call, type: "tool-result", output: sdk.error, isError: true }]
        : [];
    }
    case "tool-approval-request": {
      const call = toolIdentity(sdk);
      return call
        ? [{ ...call, type: "tool-approval-request", input: sdk.input }]
        : [];
    }
    case "source": {
      const source = logicalSource(sdk);
      return source ? [{ type: "source", source }] : [];
    }
    case "file": {
      return mediaEvents<TPartial>(sdk);
    }
    case "error":
      throw sdk.error ?? new Error("AI SDK stream failed.");
    case "abort":
      throw new DOMException("Aborted", "AbortError");
    default:
      // Provider-step framing, text/reasoning block boundaries, unfinished
      // tool-input JSON, and `raw` passthrough are all physical. Dropping them
      // is the point of this mapper, not an omission.
      return [];
  }
}

function toolIdentity(
  part: SdkPart,
): { readonly toolCallId: string; readonly toolName: string } | undefined {
  const toolCallId = part.toolCallId;
  const toolName = part.toolName;
  return typeof toolCallId === "string" && typeof toolName === "string"
    ? { toolCallId, toolName }
    : undefined;
}

function logicalSource(part: SdkPart): StreamSource | undefined {
  const id = typeof part.id === "string" ? part.id : undefined;
  if (id === undefined) return undefined;
  const title = typeof part.title === "string" ? part.title : undefined;
  // Per-source provider metadata belongs on the source; operation-wide provider
  // metadata stays on `completion`.
  const metadata = part.providerMetadata;
  if (part.sourceType === "document") {
    const mediaType =
      typeof part.mediaType === "string" ? part.mediaType : undefined;
    if (mediaType === undefined || title === undefined) return undefined;
    const filename =
      typeof part.filename === "string" ? part.filename : undefined;
    return {
      kind: "document",
      id,
      mediaType,
      title,
      ...(filename !== undefined ? { filename } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    };
  }
  const url = typeof part.url === "string" ? part.url : undefined;
  if (url === undefined) return undefined;
  return {
    kind: "url",
    id,
    url,
    ...(title !== undefined ? { title } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/**
 * Decode a generated-file part into canonical media.
 *
 * @remarks
 * Reuses the package's one AI SDK content decoder rather than re-deriving media
 * sources here, so a streamed file and the same file in the final transcript
 * cannot decode differently.
 */
function mediaEvents<TPartial>(
  part: SdkPart,
): readonly PublishedStreamEvent<TPartial>[] {
  const decoded = decodeContentFromAiSdkParts([part as Record<string, unknown>]);
  if (typeof decoded === "string") return [];
  const events: PublishedStreamEvent<TPartial>[] = [];
  for (const candidate of decoded) {
    const content = candidate as ContentPart;
    if (content.type === "text") continue;
    events.push({ type: "media", part: content });
  }
  return events;
}
