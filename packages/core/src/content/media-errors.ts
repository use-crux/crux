/**
 * Functional media-boundary errors for multimodal input validation.
 *
 * These factories return normal `Error` values decorated with stable fields so
 * callers can narrow failures without depending on custom classes or
 * `instanceof` checks.
 *
 * @module
 */

/** One unsupported media capability discovered before provider I/O starts. */
export type UnsupportedCapabilityIssue = {
  readonly capability: string;
  readonly path?: string;
  readonly mediaType?: string;
  readonly remediation?: string;
};

/**
 * Tagged error for valid input that the selected adapter or model cannot send.
 *
 * The message names the adapter, model, capability, safe message path, and
 * remediation while confirming that no provider request was made. It never
 * includes raw bytes, base64 data, provider file ids, complete refs, or signed
 * URL credentials.
 */
export type UnsupportedCapabilityError = Error & {
  readonly name: "UnsupportedCapabilityError";
  readonly code: "unsupported_capability";
  readonly adapter: string;
  readonly model: string;
  readonly capability: string;
  readonly path?: string;
  readonly mediaType?: string;
  readonly issues: readonly [
    UnsupportedCapabilityIssue,
    ...UnsupportedCapabilityIssue[],
  ];
};

/**
 * Tagged error for malformed media source values.
 *
 * Use this when validation fails before adapter capability checks: invalid
 * protocol, unmarked base64, conflicting MIME types, unsupported source shape,
 * or an `AssetRef` that must be hydrated with `assetStore.get(ref)` first.
 */
export type InvalidMediaSourceError = Error & {
  readonly name: "InvalidMediaSourceError";
  readonly code: "invalid_media_source";
  readonly path: string;
  readonly reason: string;
};

/**
 * Create a tagged error for adapter/model media capabilities rejected pre-I/O.
 *
 * Adapters use this after prompt resolution and before any provider, gateway,
 * store, or download call. The first issue is mirrored onto top-level fields
 * for simple catch blocks, while `issues` preserves every failure in order.
 *
 * @example
 * ```ts
 * throw createUnsupportedCapabilityError({
 *   adapter: 'openai',
 *   model: 'gpt-test',
 *   issues: [{ capability: 'input.image', path: 'messages[0].content[1].source' }],
 * })
 * ```
 */
export function createUnsupportedCapabilityError(
  options: Readonly<{
    adapter: string;
    model: string;
    issues: readonly [
      UnsupportedCapabilityIssue,
      ...UnsupportedCapabilityIssue[],
    ];
  }>,
): UnsupportedCapabilityError {
  const [first] = options.issues;
  return Object.freeze(
    Object.assign(
      new Error(
        unsupportedCapabilityMessage(
          options.adapter,
          options.model,
          options.issues,
        ),
      ),
      {
        name: "UnsupportedCapabilityError" as const,
        code: "unsupported_capability" as const,
        adapter: options.adapter,
        model: options.model,
        capability: first.capability,
        ...(first.path !== undefined ? { path: first.path } : {}),
        ...(first.mediaType !== undefined
          ? { mediaType: first.mediaType }
          : {}),
        issues: Object.freeze(
          options.issues.map((issue) => Object.freeze({ ...issue })),
        ) as readonly [
          UnsupportedCapabilityIssue,
          ...UnsupportedCapabilityIssue[],
        ],
      },
    ),
  );
}

/** Narrow unknown thrown values to the structural unsupported-capability tag. */
export function isUnsupportedCapabilityError(
  value: unknown,
): value is UnsupportedCapabilityError {
  return (
    isRecord(value) &&
    value.name === "UnsupportedCapabilityError" &&
    value.code === "unsupported_capability" &&
    typeof value.adapter === "string" &&
    typeof value.model === "string" &&
    typeof value.capability === "string" &&
    Array.isArray(value.issues) &&
    value.issues.length > 0
  );
}

/**
 * Create a tagged error for malformed media source values rejected pre-I/O.
 *
 * Use this for invalid URL protocols, raw base64 strings, MIME conflicts,
 * typeless bytes, unsupported source shapes, or `AssetRef` values that must be
 * hydrated by their owning `AssetStore` before model invocation. The error has
 * no side effects and does not retain raw media or secret locators.
 */
export function createInvalidMediaSourceError(
  options: Readonly<{ path: string; reason: string }>,
): InvalidMediaSourceError {
  return Object.freeze(
    Object.assign(new Error(`${options.path}: ${options.reason}`), {
      name: "InvalidMediaSourceError" as const,
      code: "invalid_media_source" as const,
      path: options.path,
      reason: options.reason,
    }),
  );
}

/** Narrow unknown thrown values to the structural invalid-media-source tag. */
export function isInvalidMediaSourceError(
  value: unknown,
): value is InvalidMediaSourceError {
  return (
    isRecord(value) &&
    value.name === "InvalidMediaSourceError" &&
    value.code === "invalid_media_source" &&
    typeof value.path === "string" &&
    typeof value.reason === "string"
  );
}

/** Exact reason a bounded media materializer rejected a download. */
export type MediaMaterializationReason =
  | "blocked-address"
  | "redirect"
  | "byte-limit"
  | "time-limit"
  | "mime-mismatch";

/**
 * Tagged error for a rejected media materialization attempt.
 *
 * Materializers throw this instead of a raw fetch error so callers can branch
 * on `reason` without depending on error-message text. It never carries the
 * requested URL, downloaded bytes, filename, provider id, or `AssetRef` URI.
 */
export type MediaMaterializationError = Error & {
  readonly name: "MediaMaterializationError";
  readonly code: "media_materialization_failed";
  readonly reason: MediaMaterializationReason;
};

/**
 * Create a tagged error for a bounded media materializer rejection.
 *
 * @example
 * ```ts
 * throw createMediaMaterializationError({ reason: 'byte-limit' })
 * ```
 */
export function createMediaMaterializationError(
  options: Readonly<{ reason: MediaMaterializationReason }>,
): MediaMaterializationError {
  return Object.freeze(
    Object.assign(new Error(mediaMaterializationMessage(options.reason)), {
      name: "MediaMaterializationError" as const,
      code: "media_materialization_failed" as const,
      reason: options.reason,
    }),
  );
}

/** Narrow unknown thrown values to the structural media-materialization tag. */
export function isMediaMaterializationError(
  value: unknown,
): value is MediaMaterializationError {
  return (
    isRecord(value) &&
    value.name === "MediaMaterializationError" &&
    value.code === "media_materialization_failed" &&
    isMediaMaterializationReason(value.reason)
  );
}

function isMediaMaterializationReason(
  value: unknown,
): value is MediaMaterializationReason {
  return (
    value === "blocked-address" ||
    value === "redirect" ||
    value === "byte-limit" ||
    value === "time-limit" ||
    value === "mime-mismatch"
  );
}

function mediaMaterializationMessage(
  reason: MediaMaterializationReason,
): string {
  switch (reason) {
    case "blocked-address":
      return "Media download target resolved to a blocked network address.";
    case "redirect":
      return "Media download redirect was rejected.";
    case "byte-limit":
      return "Media download exceeded the byte limit.";
    case "time-limit":
      return "Media download exceeded the time limit.";
    case "mime-mismatch":
      return "Media download content did not match the expected media type.";
  }
}

function unsupportedCapabilityMessage(
  adapter: string,
  model: string,
  issues: readonly UnsupportedCapabilityIssue[],
): string {
  const details = issues
    .map((issue) => {
      const path = issue.path ? ` at ${issue.path}` : "";
      const mediaType = issue.mediaType ? ` for ${issue.mediaType}` : "";
      const remediation = issue.remediation ? ` ${issue.remediation}` : "";
      return `${issue.capability}${path}${mediaType}.${remediation}`;
    })
    .join(" ");
  return `${adapter} model ${model} does not support: ${details} No provider request was made.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
