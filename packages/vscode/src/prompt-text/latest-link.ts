import type { Utf16Position } from "./contracts.js";
import type { PromptTextPreviewSource } from "./preview/types.js";

export const promptTextOpenLatestRunCommand = "crux.promptText.openLatestRun";
export const promptTextOpenLatestRunLinkMethod =
  "crux/promptText/openLatestRunLink";

export interface PromptTextOpenLatestRunLinkParams {
  readonly uri: string;
  readonly openEpoch: number;
  readonly version: number;
  readonly sourceHash: string;
  readonly position: Utf16Position;
}

export type PromptTextOpenLatestRunLinkResult =
  | { readonly kind: "ready"; readonly url: string }
  | {
      readonly kind: "unavailable";
      readonly reason:
        | "document-not-open"
        | "revision-mismatch"
        | "analysis-unavailable"
        | "template-not-found"
        | "template-ambiguous"
        | "template-unsupported"
        | "context-owner"
        | "named-fragment"
        | "anonymous-fragment"
        | "ownerless"
        | "owner-unavailable";
      readonly message: string;
    };

/** Build the exact stamped latest-Run request without interpreting syntax. */
export function promptTextOpenLatestRunLinkParams(
  source: PromptTextPreviewSource,
  position: Utf16Position,
): PromptTextOpenLatestRunLinkParams {
  return {
    uri: source.uri,
    openEpoch: source.openEpoch,
    version: source.version,
    sourceHash: source.sourceHash,
    position,
  };
}

/** Strictly detach one untrusted Local latest-Run owner-link response. */
export function parsePromptTextLatestRunLinkResult(
  value: unknown,
): PromptTextOpenLatestRunLinkResult | undefined {
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
 * Accept only the server-authored canonical latest-Run resolver URL.
 *
 * The URL must use HTTP loopback at Local's configured port and carry exactly
 * one canonically encoded Prompt owner component.
 */
export function validatedPromptTextLatestRunUrl(
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
  const match = /^\/library\/index\/prompt\/([^/]+)\/latest-run$/u.exec(
    url.pathname,
  );
  if (match === null) return undefined;
  let definitionId: string;
  try {
    definitionId = decodeURIComponent(match[1]!);
  } catch {
    return undefined;
  }
  if (
    !validScalarString(definitionId, 1, 512) ||
    encodeURIComponent(definitionId) !== match[1]
  ) {
    return undefined;
  }
  return value;
}

function validScalarString(
  value: string,
  minimum: number,
  maximum: number,
): boolean {
  if (value.length < minimum || value.length > maximum) return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
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

function isUnavailableReason(
  value: unknown,
): value is Extract<
  PromptTextOpenLatestRunLinkResult,
  { kind: "unavailable" }
>["reason"] {
  return (
    value === "document-not-open" ||
    value === "revision-mismatch" ||
    value === "analysis-unavailable" ||
    value === "template-not-found" ||
    value === "template-ambiguous" ||
    value === "template-unsupported" ||
    value === "context-owner" ||
    value === "named-fragment" ||
    value === "anonymous-fragment" ||
    value === "ownerless" ||
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
