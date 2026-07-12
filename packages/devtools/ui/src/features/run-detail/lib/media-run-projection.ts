/**
 * Pure Runs projections for multimodal execution, lineage, and transcripts.
 *
 * Local capture may retain transcript text/speakers; production-exported
 * records omit them unless explicitly configured. Raw media is never rendered.
 *
 * @module
 */

import {
  asRecord,
  collectDescriptors,
  executionValue,
  numberValue,
  stringValue,
} from "./media-run-helpers";
import type {
  GraphLikeRecord,
  MediaLineageEdge,
  MediaLineageNode,
  MediaRunView,
  TranscriptSegmentView,
  TranscriptTimelineView,
} from "./media-run-projection-types";

export type {
  GraphLikeRecord,
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
 */
export function projectMediaRunView(
  records: readonly GraphLikeRecord[],
  options: Readonly<{ exportMode?: boolean; catalogJoinId?: string }> = {},
): MediaRunView | undefined {
  const mediaStart = records.find(
    (record) =>
      record.type === "span:start" &&
      typeof record.primitive === "string" &&
      record.primitive.startsWith("media."),
  );
  if (!mediaStart || !mediaStart.spanId || !mediaStart.primitive) return undefined;

  const mediaEnd = records.find(
    (record) =>
      record.type === "span:end" && record.spanId === mediaStart.spanId,
  );
  const attributes = {
    ...(mediaStart.attributes ?? {}),
    ...(mediaEnd?.attributes ?? {}),
  };

  const artifacts = records.filter((record) => record.type === "artifact");
  const inputs = collectDescriptors(
    artifacts.filter((artifact) => artifact.kind === "input"),
  );
  const outputs = collectDescriptors(
    artifacts.filter((artifact) => artifact.kind === "output"),
  );

  const attempts = records
    .filter(
      (record) =>
        record.type === "span:start" &&
        typeof record.spanId === "string" &&
        typeof record.primitive === "string",
    )
    .map((start) => {
      const end = records.find(
        (record) =>
          record.type === "span:end" && record.spanId === start.spanId,
      );
      return Object.freeze({
        spanId: start.spanId!,
        primitive: start.primitive!,
        name: start.name ?? start.primitive!,
        status: end?.status ?? "running",
        parentSpanId: start.parentSpanId,
        ...(stringValue(start.attributes?.provider)
          ? { provider: stringValue(start.attributes?.provider) }
          : {}),
        ...(stringValue(start.attributes?.model)
          ? { model: stringValue(start.attributes?.model) }
          : {}),
        ...(numberValue(end?.durationMs) !== undefined
          ? { durationMs: numberValue(end?.durationMs) }
          : {}),
      });
    });

  const inputIds = artifacts
    .filter((artifact) => artifact.kind === "input" && artifact.artifactId)
    .map((artifact) => artifact.artifactId!);
  const outputIds = artifacts
    .filter((artifact) => artifact.kind === "output" && artifact.artifactId)
    .map((artifact) => artifact.artifactId!);
  const reportIds = artifacts
    .filter(
      (artifact) => artifact.kind === "media.report" && artifact.artifactId,
    )
    .map((artifact) => artifact.artifactId!);

  const nodes: MediaLineageNode[] = [
    ...inputIds.map((id) =>
      Object.freeze({ id, kind: "input" as const, label: "input" }),
    ),
    Object.freeze({
      id: mediaStart.spanId,
      kind: "operation" as const,
      label: mediaStart.primitive,
    }),
    ...outputIds.map((id) =>
      Object.freeze({ id, kind: "output" as const, label: "output" }),
    ),
    ...reportIds.map((id) =>
      Object.freeze({ id, kind: "report" as const, label: "media.report" }),
    ),
  ];
  if (options.catalogJoinId) {
    nodes.push(
      Object.freeze({
        id: options.catalogJoinId,
        kind: "catalog",
        label: "catalog",
      }),
    );
  }

  const edges: MediaLineageEdge[] = records
    .filter((record) => record.type === "edge")
    .flatMap((edge) => {
      const from = edge.from?.id;
      const to = edge.to?.id;
      if (!from || !to || !edge.edgeType) return [];
      return [Object.freeze({ from, to, type: edge.edgeType })];
    });

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
    attempts: Object.freeze(attempts),
    transcript: projectTranscript(
      mediaStart.primitive,
      artifacts,
      options.exportMode === true,
    ),
    lineage: Object.freeze({
      nodes: Object.freeze(nodes),
      edges: Object.freeze(edges),
    }),
    ...(options.catalogJoinId ? { catalogJoinId: options.catalogJoinId } : {}),
  });
}

/** Assert a Runs media panel never retains or renders forbidden media fields. */
export function assertNoRetainedMediaSecrets(value: unknown): readonly string[] {
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
            ...(stringValue(record.text) ? { text: stringValue(record.text) } : {}),
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
