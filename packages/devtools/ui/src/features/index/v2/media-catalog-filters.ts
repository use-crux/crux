/** Filter and badge helpers for media Catalog cards. */

import type {
  IngestSourceCatalogView,
  MediaCatalogFilter,
  MediaModality,
  MediaOperationCatalogView,
} from "./media-catalog";
import type { EmbeddingConsumerCatalogView } from "./embedding-catalog";
import { mediaOperationDeliveryBadge } from "./media-operation-presentation";

type MediaCatalogView =
  | MediaOperationCatalogView
  | IngestSourceCatalogView
  | EmbeddingConsumerCatalogView;

/** Return true when a media Catalog card matches one or more filters. */
export function matchesMediaCatalogFilter(
  view: MediaCatalogView,
  filter: MediaCatalogFilter,
): boolean {
  switch (filter) {
    case "media":
      return true;
    case "embeddings":
      return view.kind === "embedding.consumer";
    case "ingest-sources":
      return view.kind === "ingest.source";
    case "has-warnings":
      return "warningCount" in view && view.warningCount > 0;
    case "images":
      return hasModality(view, "image");
    case "audio":
      return hasModality(view, "audio");
    case "video":
      return hasModality(view, "video");
    case "documents":
      return hasModality(view, "document");
    case "generated-media":
      return (
        view.kind === "media.operation" &&
        (view.operation === "generateImage" ||
          view.operation === "streamImage" ||
          view.operation === "generateSpeech" ||
          view.operation === "streamSpeech" ||
          view.operation === "generate" ||
          view.operation === "stream")
      );
    case "transcription":
      return view.kind === "media.operation" && view.operation === "transcribe";
    case "speech":
      return (
        view.kind === "media.operation" &&
        (view.operation === "generateSpeech" ||
          view.operation === "streamSpeech")
      );
    case "native":
      return view.kind === "media.operation" && view.execution === "native";
    case "composed":
      return view.kind === "media.operation" && view.execution === "composed";
    case "unknown-support":
      return view.kind === "media.operation" && view.execution === "unknown";
  }
}

/** Stable badge labels for media Catalog cards (unknown ≠ unsupported). */
export function mediaCatalogBadges(
  view: MediaCatalogView,
): readonly string[] {
  if (view.kind === "embedding.consumer") {
    return Object.freeze([
      "embedding consumer",
      ...new Set(view.embeddings.flatMap((embedding) => embedding.modalities)),
    ]);
  }
  if (view.kind === "ingest.source") {
    return Object.freeze([
      "ingest source",
      view.sourceKind,
      ...view.mediaKinds,
      ...(view.warningCount > 0 ? [`${view.warningCount} warnings`] : []),
    ]);
  }
  const delivery = mediaOperationDeliveryBadge(view.operation);
  return Object.freeze([
    view.operation,
    ...(delivery ? [delivery] : []),
    view.execution === "unknown" ? "unknown support" : view.execution,
    ...view.inputModalities.map((modality) => `in:${modality}`),
    ...view.outputModalities.map((modality) => `out:${modality}`),
    ...(view.adapter ? [view.adapter] : []),
    ...(view.model ? [view.model] : []),
    ...(view.warningCount > 0 ? [`${view.warningCount} warnings`] : []),
  ]);
}

function hasModality(
  view: MediaCatalogView,
  modality: MediaModality,
): boolean {
  if (view.kind === "ingest.source") return view.mediaKinds.includes(modality);
  if (view.kind === "embedding.consumer") {
    return view.embeddings.some((embedding) =>
      embedding.modalities.includes(modality),
    );
  }
  return (
    view.inputModalities.includes(modality) ||
    view.outputModalities.includes(modality)
  );
}
