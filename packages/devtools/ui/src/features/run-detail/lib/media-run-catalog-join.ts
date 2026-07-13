/**
 * Runtime → Catalog source join for multimodal Runs.
 *
 * Exact join only. Completed media operations currently emit provider,
 * operation, model, execution, and call facts — not a Catalog definition id.
 * Project Index `media.operation` definitions also set `runtimeJoin: false`.
 * Until an upstream contract records `definitionId` (or equivalent) on the
 * media span, the join is an explicit unavailable state. Do not invent fuzzy
 * matches from operation name / provider / model.
 *
 * Labels never derive from definitionId (including suffix stripping). The id
 * remains internal for navigation only.
 *
 * @module
 */

import { stringValue } from "./media-run-helpers";
import type { MediaCatalogJoin } from "./media-run-projection-types";

/** Exact attribute keys accepted as recorded Catalog definition identity. */
const DEFINITION_ID_KEYS = [
  "definitionId",
  "catalogDefinitionId",
] as const;

const DEFINITION_NAME_KEYS = [
  "definitionName",
  "catalogDefinitionName",
  "catalogName",
] as const;

/** Fixed generic label when no separately recorded safe display name exists. */
export const GENERIC_CATALOG_MEDIA_LABEL = "Catalog media operation";

/**
 * Resolve the Catalog join from recorded span attributes / explicit options.
 *
 * @param attributes - Merged media span attributes after capture/retention.
 * @param options.catalogJoinId - Optional exact definition id already known to
 *   the caller (tests or a future presentation field). Not a fuzzy guess.
 */
export function resolveMediaCatalogJoin(
  attributes: Readonly<Record<string, unknown>> | undefined,
  options: Readonly<{ catalogJoinId?: string }> = {},
): MediaCatalogJoin {
  const definitionId =
    firstString(attributes, DEFINITION_ID_KEYS) ??
    stringValue(options.catalogJoinId);
  if (!definitionId) {
    return Object.freeze({
      status: "unavailable",
      reason: "missing-runtime-join",
    });
  }
  return Object.freeze({
    status: "joined",
    definitionId,
    label: safeCatalogDisplayLabel(
      firstString(attributes, DEFINITION_NAME_KEYS),
      definitionId,
    ),
  });
}

/**
 * Choose a safe human label for Catalog display.
 * Never derives text from definitionId (no suffix stripping).
 */
export function safeCatalogDisplayLabel(
  displayName: string | undefined,
  definitionId: string,
): string {
  if (!displayName) return GENERIC_CATALOG_MEDIA_LABEL;
  if (displayName === definitionId) return GENERIC_CATALOG_MEDIA_LABEL;
  if (isUnsafeLocatorLikeLabel(displayName)) return GENERIC_CATALOG_MEDIA_LABEL;
  return displayName;
}

function isUnsafeLocatorLikeLabel(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("data:")) return true;
  if (/^(?:https?|asset|convex|s3|gs|blob):\/\//i.test(trimmed)) return true;
  if (trimmed.includes("://")) return true;
  return false;
}

function firstString(
  attributes: Readonly<Record<string, unknown>> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!attributes) return undefined;
  for (const key of keys) {
    const value = stringValue(attributes[key]);
    if (value) return value;
  }
  return undefined;
}
