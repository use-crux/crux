import type { Utf16Position } from "./contracts.js";
import type { PromptTextPreviewSource } from "./preview/types.js";

export const promptTextPreviewExactCommand = "crux.promptText.previewExact";
export const promptTextPreviewExactLinkMethod =
  "crux/promptText/previewExactLink";

export interface PromptTextPreviewExactLinkParams {
  readonly uri: string;
  readonly openEpoch: number;
  readonly version: number;
  readonly sourceHash: string;
  readonly position: Utf16Position;
}

export type PromptTextPreviewExactLinkResult =
  | { readonly kind: "ready"; readonly url: string }
  | {
      readonly kind: "static-only";
      readonly reason:
        | "context-owner"
        | "named-fragment"
        | "anonymous-fragment"
        | "ownerless";
      readonly message: string;
    }
  | {
      readonly kind: "unavailable";
      readonly reason:
        | "document-not-open"
        | "revision-mismatch"
        | "analysis-unavailable"
        | "template-not-found"
        | "template-ambiguous"
        | "template-unsupported"
        | "owner-unavailable";
      readonly message: string;
    };

/** Build the exact stamped request without interpreting source syntax. */
export function promptTextPreviewExactLinkParams(
  source: PromptTextPreviewSource,
  position: Utf16Position,
): PromptTextPreviewExactLinkParams {
  return {
    uri: source.uri,
    openEpoch: source.openEpoch,
    version: source.version,
    sourceHash: source.sourceHash,
    position,
  };
}

/** Strictly detach one untrusted Local owner-link response. */
export function parsePromptTextPreviewExactLinkResult(
  value: unknown,
): PromptTextPreviewExactLinkResult | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.kind === "ready" &&
    hasExactKeys(value, ["kind", "url"]) &&
    typeof value.url === "string" &&
    value.url !== ""
  ) {
    return { kind: "ready", url: value.url };
  }
  if (
    value.kind === "static-only" &&
    hasExactKeys(value, ["kind", "reason", "message"]) &&
    isStaticReason(value.reason) &&
    typeof value.message === "string" &&
    value.message !== ""
  ) {
    return {
      kind: "static-only",
      reason: value.reason,
      message: value.message,
    };
  }
  if (
    value.kind === "unavailable" &&
    hasExactKeys(value, ["kind", "reason", "message"]) &&
    isUnavailableReason(value.reason) &&
    typeof value.message === "string" &&
    value.message !== ""
  ) {
    return {
      kind: "unavailable",
      reason: value.reason,
      message: value.message,
    };
  }
  return undefined;
}

/**
 * Accept only the server-authored Local URL. The extension never constructs,
 * rewrites, or adds definition identity to it.
 */
export function validatedPromptTextExactPreviewUrl(
  value: string,
  configuredPort: number,
): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const effectivePort =
    url.port === "" && url.protocol === "http:" ? 80 : Number(url.port);
  if (
    url.protocol !== "http:" ||
    url.username !== "" ||
    url.password !== "" ||
    effectivePort !== configuredPort ||
    url.search !== "" ||
    url.hash !== "" ||
    !isLoopbackHostname(url.hostname)
  ) {
    return undefined;
  }
  return value;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "[::1]" ||
    normalized === "::1"
  ) {
    return true;
  }
  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet)) &&
    Number(octets[0]) === 127 &&
    octets.every((octet) => Number(octet) <= 255)
  );
}

function isStaticReason(
  value: unknown,
): value is Extract<
  PromptTextPreviewExactLinkResult,
  { kind: "static-only" }
>["reason"] {
  return (
    value === "context-owner" ||
    value === "named-fragment" ||
    value === "anonymous-fragment" ||
    value === "ownerless"
  );
}

function isUnavailableReason(
  value: unknown,
): value is Extract<
  PromptTextPreviewExactLinkResult,
  { kind: "unavailable" }
>["reason"] {
  return (
    value === "document-not-open" ||
    value === "revision-mismatch" ||
    value === "analysis-unavailable" ||
    value === "template-not-found" ||
    value === "template-ambiguous" ||
    value === "template-unsupported" ||
    value === "owner-unavailable"
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
