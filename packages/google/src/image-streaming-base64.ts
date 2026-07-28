import type { Asset } from "@use-crux/core";

const BASE64_BODY = /^[A-Za-z0-9+/]+$/;
const PADDED_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const IMAGE_MEDIA_TYPE = /^image\/[a-z0-9.+-]+$/i;

type OwnedBytes = ReturnType<typeof Uint8Array.from>;

/** Mutable byte assembly owned by one native Google image step. */
export interface GoogleImageAssembly {
  readonly stepIndex: number;
  readonly outputIndex: number;
  readonly chunks: OwnedBytes[];
  sequence: number;
  mediaType?: string;
  remainder: string;
  padded: boolean;
}

/** Create isolated append-only state for one first-seen native step index. */
export function createGoogleImageAssembly(
  stepIndex: number,
  outputIndex: number,
): GoogleImageAssembly {
  return {
    stepIndex,
    outputIndex,
    chunks: [],
    sequence: 0,
    remainder: "",
    padded: false,
  };
}

/**
 * Decode one base64 fragment without joining already-decoded image bytes.
 *
 * Complete four-character groups become canonical append-only deltas. A short
 * trailing group stays private until a later native delta or terminal flush.
 */
export function appendGoogleImageBase64(
  assembly: GoogleImageAssembly,
  data: string | undefined,
  mediaType: string | undefined,
): OwnedBytes | undefined {
  establishMediaType(assembly, mediaType);
  if (typeof data !== "string" || data.length === 0) {
    throw protocolError(assembly, "must contain non-empty base64 data");
  }
  if (assembly.padded) {
    throw protocolError(assembly, "received data after base64 padding");
  }

  const combined = assembly.remainder + data;
  if (combined.includes("=")) {
    if (combined.length % 4 !== 0 || !PADDED_BASE64.test(combined)) {
      throw protocolError(assembly, "contains malformed base64 padding");
    }
    assembly.remainder = "";
    assembly.padded = true;
    return retainDecoded(assembly, combined);
  }
  if (!BASE64_BODY.test(combined)) {
    throw protocolError(assembly, "contains invalid base64 characters");
  }

  const completeLength = combined.length - (combined.length % 4);
  assembly.remainder = combined.slice(completeLength);
  if (completeLength === 0) return undefined;
  return retainDecoded(assembly, combined.slice(0, completeLength));
}

/** Flush a valid short terminal group into one final canonical delta. */
export function flushGoogleImageBase64(
  assembly: GoogleImageAssembly,
): OwnedBytes | undefined {
  if (assembly.remainder.length === 0) return undefined;
  if (assembly.remainder.length === 1) {
    throw protocolError(assembly, "ended with an incomplete base64 group");
  }
  const padded = assembly.remainder.padEnd(4, "=");
  assembly.remainder = "";
  assembly.padded = true;
  return retainDecoded(assembly, padded);
}

/** Build the final Blob asset from the exact byte chunks used by canonical deltas. */
export function googleImageAsset(assembly: GoogleImageAssembly): Asset {
  if (assembly.mediaType === undefined || assembly.chunks.length === 0) {
    throw protocolError(assembly, "did not produce image bytes");
  }
  return Object.freeze({
    type: "data" as const,
    data: new Blob(assembly.chunks, { type: assembly.mediaType }),
    mediaType: assembly.mediaType,
  });
}

function establishMediaType(
  assembly: GoogleImageAssembly,
  mediaType: string | undefined,
): void {
  if (mediaType !== undefined && !IMAGE_MEDIA_TYPE.test(mediaType)) {
    throw protocolError(assembly, "has an invalid image MIME type");
  }
  if (assembly.mediaType === undefined) {
    if (mediaType === undefined) {
      throw protocolError(
        assembly,
        "must declare a MIME type on its first delta",
      );
    }
    assembly.mediaType = mediaType;
    return;
  }
  if (mediaType !== undefined && mediaType !== assembly.mediaType) {
    throw protocolError(assembly, "changed MIME type between deltas");
  }
}

function retainDecoded(
  assembly: GoogleImageAssembly,
  data: string,
): OwnedBytes {
  const decoded = Uint8Array.from(Buffer.from(data, "base64"));
  if (decoded.byteLength === 0) {
    throw protocolError(assembly, "decoded to an empty byte fragment");
  }
  assembly.chunks.push(decoded);
  return decoded;
}

function protocolError(
  assembly: Pick<GoogleImageAssembly, "stepIndex">,
  problem: string,
): TypeError {
  return new TypeError(
    `Google image stream step ${assembly.stepIndex} ${problem}.`,
  );
}
