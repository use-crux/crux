/**
 * Safe page/time attribution extraction for multimodal Runs lineage.
 *
 * Only structured page/time facts — never locators, filenames, IDs, or refs.
 *
 * @module
 */

import {
  asRecord,
  collectDescriptors,
  numberValue,
} from "./media-run-helpers";
import type {
  GraphLikeRecord,
  MediaAttribution,
} from "./media-run-projection-types";

export function attributionFromArtifact(
  artifact: GraphLikeRecord,
): MediaAttribution | undefined {
  const fromPreview = attributionFromUnknown(artifact.preview);
  if (fromPreview) return fromPreview;
  if (artifact.kind !== "input" && artifact.kind !== "output") return undefined;
  const descriptors = collectDescriptors([artifact]);
  const withPages = descriptors.find(
    (descriptor) => numberValue(descriptor.pageCount) !== undefined,
  );
  if (withPages?.pageCount !== undefined) {
    return Object.freeze({ type: "pages", pageCount: withPages.pageCount });
  }
  const withTime = descriptors.find(
    (descriptor) => numberValue(descriptor.durationSeconds) !== undefined,
  );
  if (withTime?.durationSeconds !== undefined) {
    return Object.freeze({
      type: "time",
      start: 0,
      end: withTime.durationSeconds,
    });
  }
  return undefined;
}

export function attributionFromRetrievalHits(
  preview: unknown,
): MediaAttribution | undefined {
  const record = asRecord(preview);
  if (!record || !Array.isArray(record.hits)) return undefined;
  for (const hit of record.hits) {
    const hitRecord = asRecord(hit);
    const source = asRecord(hitRecord?.source);
    const attribution = attributionFromUnknown(source?.location ?? source);
    if (attribution) return attribution;
  }
  return undefined;
}

export function attributionFromUnknown(
  value: unknown,
): MediaAttribution | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const nestedLocation = asRecord(record.location);
  if (nestedLocation) {
    const nested = attributionFromLocation(nestedLocation);
    if (nested) return nested;
  }

  const direct = attributionFromLocation(record);
  if (direct) return direct;

  const pageNumber = numberValue(record.pageNumber);
  if (pageNumber !== undefined && pageNumber > 0) {
    return Object.freeze({ type: "page", pageNumber });
  }
  const pageCount = numberValue(record.pageCount);
  if (pageCount !== undefined && pageCount > 0) {
    return Object.freeze({ type: "pages", pageCount });
  }

  for (const child of Object.values(record)) {
    if (child === record.location) continue;
    const childRecord = asRecord(child);
    if (!childRecord || Array.isArray(child)) continue;
    const childAttribution = attributionFromUnknown(childRecord);
    if (childAttribution) return childAttribution;
  }
  return undefined;
}

function attributionFromLocation(
  location: Record<string, unknown>,
): MediaAttribution | undefined {
  if (location.type === "page") {
    const pageNumber = numberValue(location.pageNumber);
    if (pageNumber !== undefined && pageNumber > 0) {
      return Object.freeze({ type: "page", pageNumber });
    }
  }
  if (location.type === "time") {
    const start = numberValue(location.start);
    const end = numberValue(location.end);
    if (start !== undefined && end !== undefined) {
      return Object.freeze({ type: "time", start, end });
    }
  }
  const start =
    numberValue(location.start) ?? numberValue(location.startSecond);
  const end = numberValue(location.end) ?? numberValue(location.endSecond);
  if (
    start !== undefined &&
    end !== undefined &&
    location.type !== "page" &&
    (location.type === "time" ||
      location.startSecond !== undefined ||
      location.endSecond !== undefined)
  ) {
    return Object.freeze({ type: "time", start, end });
  }
  return undefined;
}

/** Format attribution for accessible Runs copy. */
export function formatMediaAttribution(
  attribution: MediaAttribution | undefined,
): string | undefined {
  if (!attribution) return undefined;
  if (attribution.type === "page") return `page ${attribution.pageNumber}`;
  if (attribution.type === "pages") return `${attribution.pageCount} pages`;
  return `${attribution.start}–${attribution.end}s`;
}
