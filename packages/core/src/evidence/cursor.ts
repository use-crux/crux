/**
 * Opaque active-collector evidence cursor encoding.
 *
 * @internal
 * @module
 */

import { evidenceCursorInvalidError } from "./errors";
import type { EvidenceRole } from "./roles";

interface LocalEvidenceCursor {
  readonly v: 1;
  readonly subject: string;
  readonly role: EvidenceRole;
  readonly history: boolean;
  readonly version: number;
  readonly offset: number;
}

/** Encode a snapshot-scoped local cursor. @internal */
export function encodeLocalEvidenceCursor(
  cursor: Omit<LocalEvidenceCursor, "v">,
): string {
  return `crux-evidence:1:${base64UrlEncode(
    JSON.stringify({ v: 1, ...cursor }),
  )}`;
}

/** Decode and bind a local cursor to the current query snapshot. @internal */
export function decodeLocalEvidenceCursor(
  value: string,
  expected: Omit<LocalEvidenceCursor, "v" | "offset">,
): number {
  try {
    const prefix = "crux-evidence:1:";
    if (!value.startsWith(prefix)) throw new Error("wrong cursor family");
    const parsed = JSON.parse(
      base64UrlDecode(value.slice(prefix.length)),
    ) as Partial<LocalEvidenceCursor>;
    if (
      parsed.v !== 1 ||
      parsed.subject !== expected.subject ||
      parsed.role !== expected.role ||
      parsed.history !== expected.history ||
      parsed.version !== expected.version ||
      typeof parsed.offset !== "number" ||
      !Number.isInteger(parsed.offset) ||
      parsed.offset < 1
    ) {
      throw new Error("cursor does not match the local snapshot");
    }
    return parsed.offset;
  } catch {
    throw evidenceCursorInvalidError();
  }
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("cursor is not base64url");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}
