/**
 * Runtime → Catalog source join for multimodal Runs.
 *
 * Exact join only. Media operations do not normally observe the authored local
 * identity used by Project Index. A caller may, however, attach an exact
 * `media.operation` DefinitionRef with role `invoked-media-operation` when
 * that identity is genuinely available. Without one, the join stays
 * explicitly unavailable. Do not invent fuzzy matches from operation name,
 * provider, model, attributes, or source coordinates.
 *
 * Labels never derive from definitionId (including suffix stripping). The id
 * remains internal for navigation only.
 *
 * @module
 */

import { stringValue } from "./media-run-helpers";
import type { MediaCatalogJoin } from "./media-run-projection-types";

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
 * @param options.definitionRefs - Runtime definition references. Only exact
 *   invoked-media-operation references are eligible for navigation.
 */
export function resolveMediaCatalogJoin(
  attributes: Readonly<Record<string, unknown>> | undefined,
  options: Readonly<{
    definitionRefs?: readonly Readonly<{
      id: string;
      kind: string;
      role?: string;
    }>[];
  }> = {},
): MediaCatalogJoin {
  const definitionIds = new Set(
    (options.definitionRefs ?? [])
      .filter(
        (reference) =>
          reference.kind === "media.operation" &&
          reference.role === "invoked-media-operation",
      )
      .map((reference) => stringValue(reference.id))
      .filter((value): value is string => value !== undefined),
  );
  if (definitionIds.size > 1) {
    return Object.freeze({
      status: "unavailable",
      reason: "ambiguous-runtime-join",
    });
  }
  const definitionId = [...definitionIds][0];
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
