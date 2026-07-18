/**
 * Pure Runs projections for multimodal execution, lineage, and transcripts.
 *
 * Local capture may retain transcript text/speakers; production-exported
 * records omit them unless explicitly configured. Raw media is never rendered.
 *
 * @module
 */

import { resolveMediaCatalogJoin } from "./media-run-catalog-join";
import { projectMediaLineage } from "./media-run-lineage";
import {
  asRecord,
  collectDescriptors,
  executionValue,
  numberValue,
  stringValue,
} from "./media-run-helpers";
import type {
  GraphLikeRecord,
  MediaRunView,
  TranscriptSegmentView,
  TranscriptTimelineView,
} from "./media-run-projection-types";

export type {
  GraphLikeRecord,
  MediaAttribution,
  MediaCatalogJoin,
  MediaLineageEdge,
  MediaLineageNode,
  MediaRunAttempt,
  MediaRunSummary,
  MediaRunView,
  SafeRunMediaDescriptor,
  TranscriptSegmentView,
  TranscriptTimelineView,
} from "./media-run-projection-types";

/**
 * Project observability records for one media run into a Runs view model.
 *
 * @param records - Graph records already sanitized by capture/retention.
 * @param options.exportMode - When true, transcripts are absent by default.
 * @param options.selectedSpanId - Exact media span when the graph has many.
 */
export function projectMediaRunView(
  records: readonly GraphLikeRecord[],
  options: Readonly<{
    exportMode?: boolean;
    catalogJoinId?: string;
    selectedSpanId?: string;
  }> = {},
): MediaRunView | undefined {
  const mediaStart = selectMediaStart(records, options.selectedSpanId);
  if (!mediaStart || !mediaStart.spanId || !mediaStart.primitive)
    return undefined;

  const mediaSpanId = mediaStart.spanId;
  const mediaEnd = records.find(
    (record) => record.type === "span:end" && record.spanId === mediaSpanId,
  );
  const attributes = {
    ...(mediaStart.attributes ?? {}),
    ...(mediaEnd?.attributes ?? {}),
  };

  const attemptSpanIds = collectDescendantSpanIds(records, mediaSpanId);
  // Artifacts with a spanId stay on that span's media subtree. Legacy records
  // without spanId attach to the selected media operation (single-media graphs).
  const scopedArtifacts = records.filter((record) => {
    if (record.type !== "artifact") return false;
    if (typeof record.spanId === "string" && record.spanId.length > 0) {
      return attemptSpanIds.has(record.spanId);
    }
    return true;
  });
  const inputs = collectDescriptors(
    scopedArtifacts.filter((artifact) => artifact.kind === "input"),
  );
  const outputs = collectDescriptors(
    scopedArtifacts.filter((artifact) => artifact.kind === "output"),
  );

  const attempts = Object.freeze(
    records
      .filter(
        (record) =>
          record.type === "span:start" &&
          typeof record.spanId === "string" &&
          typeof record.primitive === "string" &&
          attemptSpanIds.has(record.spanId),
      )
      .map((start) => {
        const end = records.find(
          (record) =>
            record.type === "span:end" && record.spanId === start.spanId,
        );
        const provider =
          stringValue(start.attributes?.provider) ??
          stringValue(start.provider);
        const model =
          stringValue(start.attributes?.model) ?? stringValue(start.model);
        return Object.freeze({
          spanId: start.spanId!,
          primitive: start.primitive!,
          name: start.name ?? start.primitive!,
          status: end?.status ?? "running",
          parentSpanId: start.parentSpanId,
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
          ...(numberValue(end?.durationMs) !== undefined
            ? { durationMs: numberValue(end?.durationMs) }
            : {}),
        });
      }),
  );

  const catalogJoin = resolveMediaCatalogJoin(attributes, {
    catalogJoinId: options.catalogJoinId,
  });

  const lineage = projectMediaLineage(
    records,
    mediaSpanId,
    mediaStart.primitive,
    {
      catalogDefinitionId:
        catalogJoin.status === "joined" ? catalogJoin.definitionId : undefined,
    },
  );

  return Object.freeze({
    summary: Object.freeze({
      primitive: mediaStart.primitive,
      ...(stringValue(attributes.provider) || mediaStart.provider
        ? { provider: stringValue(attributes.provider) ?? mediaStart.provider }
        : {}),
      ...(stringValue(attributes.model) || mediaStart.model
        ? { model: stringValue(attributes.model) ?? mediaStart.model }
        : {}),
      ...(executionValue(attributes.executionKind)
        ? { executionKind: executionValue(attributes.executionKind) }
        : {}),
      ...(numberValue(attributes.calls) !== undefined
        ? { calls: numberValue(attributes.calls) }
        : {}),
      ...(numberValue(mediaEnd?.durationMs) !== undefined
        ? { durationMs: numberValue(mediaEnd?.durationMs) }
        : {}),
      ...(mediaEnd?.status ? { status: mediaEnd.status } : {}),
      ...(numberValue(attributes.costUsd) !== undefined
        ? { costUsd: numberValue(attributes.costUsd) }
        : {}),
      ...(numberValue(attributes.segments) !== undefined
        ? { segmentCount: numberValue(attributes.segments) }
        : {}),
    }),
    inputs,
    outputs,
    attempts,
    transcript: projectTranscript(
      mediaStart.primitive,
      scopedArtifacts,
      options.exportMode === true,
    ),
    lineage,
    catalogJoin,
  });
}

/** Assert a Runs media panel never retains or renders forbidden media fields. */
export function assertNoRetainedMediaSecrets(
  value: unknown,
): readonly string[] {
  const serialized = JSON.stringify(value) ?? "";
  return [
    "data:",
    "asset://",
    "filename",
    "fileId",
    "SECRET",
    "<img",
    "<audio",
    "<video",
    "blob:",
  ].filter((token) => serialized.toLowerCase().includes(token.toLowerCase()));
}

function selectMediaStart(
  records: readonly GraphLikeRecord[],
  selectedSpanId: string | undefined,
): GraphLikeRecord | undefined {
  if (selectedSpanId) {
    return records.find(
      (record) =>
        record.type === "span:start" &&
        record.spanId === selectedSpanId &&
        typeof record.primitive === "string" &&
        record.primitive.startsWith("media."),
    );
  }
  return records.find(
    (record) =>
      record.type === "span:start" &&
      typeof record.primitive === "string" &&
      record.primitive.startsWith("media."),
  );
}

/** Selected media span plus descendants linked by parentSpanId. */
export function collectDescendantSpanIds(
  records: readonly GraphLikeRecord[],
  rootSpanId: string,
): ReadonlySet<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const record of records) {
    if (
      record.type !== "span:start" ||
      typeof record.spanId !== "string" ||
      typeof record.parentSpanId !== "string" ||
      record.parentSpanId.length === 0
    ) {
      continue;
    }
    const list = childrenByParent.get(record.parentSpanId) ?? [];
    list.push(record.spanId);
    childrenByParent.set(record.parentSpanId, list);
  }

  const included = new Set<string>([rootSpanId]);
  const queue = [rootSpanId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (included.has(child)) continue;
      included.add(child);
      queue.push(child);
    }
  }
  return included;
}

function projectTranscript(
  primitive: string,
  artifacts: readonly GraphLikeRecord[],
  exportMode: boolean,
): TranscriptTimelineView {
  if (primitive !== "media.transcribe") {
    return Object.freeze({
      present: false,
      reason: "not-transcription",
      segments: Object.freeze([]),
    });
  }
  if (exportMode) {
    return Object.freeze({
      present: false,
      reason: "export-absent",
      segments: Object.freeze([]),
    });
  }

  const output = artifacts.find((artifact) => artifact.kind === "output");
  const preview = asRecord(output?.preview);
  const segments: TranscriptSegmentView[] = Array.isArray(preview?.segments)
    ? preview.segments.flatMap((item) => {
        const record = asRecord(item);
        if (!record) return [];
        return [
          Object.freeze({
            ...(numberValue(record.start) !== undefined
              ? { start: numberValue(record.start) }
              : numberValue(record.startSecond) !== undefined
                ? { start: numberValue(record.startSecond) }
                : {}),
            ...(numberValue(record.end) !== undefined
              ? { end: numberValue(record.end) }
              : numberValue(record.endSecond) !== undefined
                ? { end: numberValue(record.endSecond) }
                : {}),
            ...(stringValue(record.text)
              ? { text: stringValue(record.text) }
              : {}),
            ...(stringValue(record.speaker)
              ? { speaker: stringValue(record.speaker) }
              : {}),
          }),
        ];
      })
    : [];

  if (segments.length === 0 && typeof preview?.text === "string") {
    segments.push(Object.freeze({ text: preview.text }));
  }

  return Object.freeze({
    present: segments.length > 0,
    reason: "local-capture" as const,
    segments: Object.freeze(segments),
  });
}
