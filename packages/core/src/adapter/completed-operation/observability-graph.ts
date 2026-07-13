/**
 * Safe graph emission for completed media operations.
 *
 * Every bounded media call records one media primitive span, allowlisted
 * input/output/`media.report` artifacts, and the canonical `derived.from`
 * lineage edge. Raw media never enters previews: descriptors are projected
 * through the shared media sanitizer before artifact emission.
 *
 * @module
 * @internal
 */

import { observe } from "../../observability";
import type { CruxArtifactId, CruxSpanId } from "../../observability/contract";
import { sanitizeMediaPreview } from "../../observability/media-preview";
import type { CompletedOperationResult } from "../../completed-operation/contracts";
import { safeCompletedOperationReport } from "./report";
import {
  isCruxPrimitiveName,
  mediaPrimitiveForOperation,
  mediaSpanName,
  type MediaPrimitiveName,
} from "./observability-primitive";

/** Identity carried through one instrumented completed-media lifecycle. */
export interface CompletedMediaObservation {
  readonly primitive: MediaPrimitiveName;
  readonly spanId: CruxSpanId;
  withContext<T>(fn: () => T | Promise<T>): T | Promise<T>;
  observeChildCall<T>(
    operation: string,
    start: () => Promise<T>,
  ): Promise<T>;
  succeed(
    result: CompletedOperationResult,
    report: unknown,
    inputPreview: unknown,
    outputPreview: unknown,
  ): void;
  fail(error: unknown, inputPreview?: unknown): void;
}

/**
 * Open the media span for a completed operation when the binding name maps to
 * the media vocabulary. Non-media operations stay uninstrumented so generic
 * runner tests do not invent parallel graphs.
 */
export function openCompletedMediaObservation(options: Readonly<{
  provider: string;
  operation: string;
  model: unknown;
}>): CompletedMediaObservation | undefined {
  const primitive = mediaPrimitiveForOperation(options.operation);
  if (!primitive) return undefined;

  const modelId =
    typeof options.model === "string"
      ? options.model
      : describeModel(options.model);
  const span = observe.openSpan({
    name: mediaSpanName(primitive, options.model),
    primitive,
    attributes: {
      provider: options.provider,
      operation: options.operation,
      ...(modelId ? { model: modelId } : {}),
    },
  });

  return {
    primitive,
    spanId: span.spanId,
    withContext: span.withContext.bind(span),
    async observeChildCall(operation, start) {
      if (!isCruxPrimitiveName(operation)) {
        return start();
      }
      const child = observe.openSpan({
        name: operation,
        primitive: operation,
        implicitRun: false,
        attributes: {
          provider: options.provider,
          parentOperation: options.operation,
          childOperation: operation,
        },
      });
      try {
        const value = await child.withContext(start);
        child.end();
        observe.edge({
          edgeType: "called",
          from: { kind: "span", id: span.spanId },
          to: { kind: "span", id: child.spanId },
          attributes: { operation },
        });
        return value;
      } catch (error) {
        child.error(error);
        observe.edge({
          edgeType: "called",
          from: { kind: "span", id: span.spanId },
          to: { kind: "span", id: child.spanId },
          attributes: { operation, status: "error" },
        });
        throw error;
      }
    },
    succeed(result, report, inputPreview, outputPreview) {
      const inputId = emitArtifact("input", inputPreview, {
        provider: options.provider,
        operation: options.operation,
        direction: "input",
      });
      const outputId = emitArtifact("output", outputPreview, {
        provider: options.provider,
        operation: options.operation,
        direction: "output",
      });
      const reportPreview = buildMediaReportPreview(result, report);
      const reportId = emitArtifact("media.report", reportPreview, {
        provider: options.provider,
        operation: options.operation,
        primitive,
      });
      linkSpanArtifact(span.spanId, "consumed", inputId);
      linkSpanArtifact(span.spanId, "produced", outputId);
      linkSpanArtifact(span.spanId, "produced", reportId);
      if (inputId && outputId) {
        observe.edge({
          edgeType: "derived.from",
          from: { kind: "artifact", id: outputId },
          to: { kind: "artifact", id: inputId },
          attributes: { primitive, operation: options.operation },
        });
      }
      span.end({
        attributes: {
          provider: options.provider,
          operation: options.operation,
          executionKind: result.execution.kind,
          calls: result.execution.calls,
          status: "ok",
          ...(result.execution.kind === "composed"
            ? { operations: [...result.execution.operations] }
            : {}),
        },
      });
    },
    fail(error, inputPreview) {
      if (inputPreview !== undefined) {
        const inputId = emitArtifact("input", inputPreview, {
          provider: options.provider,
          operation: options.operation,
          direction: "input",
          status: "error",
        });
        linkSpanArtifact(span.spanId, "consumed", inputId);
      }
      span.error(error, {
        provider: options.provider,
        operation: options.operation,
        status: "error",
      });
    },
  };
}

/** Project untrusted input into a descriptor-only preview. */
export function safeMediaInputPreview(input: unknown): unknown {
  return sanitizeMediaPreview(projectMediaFacingValue(input));
}

/** Project untrusted output into a descriptor-only preview. */
export function safeMediaOutputPreview(result: unknown): unknown {
  return sanitizeMediaPreview(projectMediaFacingValue(result));
}

function buildMediaReportPreview(
  result: CompletedOperationResult,
  report: unknown,
): Readonly<Record<string, unknown>> {
  const safe = safeCompletedOperationReport(report) ?? {};
  return Object.freeze({
    ...safe,
    execution: Object.freeze(
      result.execution.kind === "composed"
        ? {
            kind: result.execution.kind,
            calls: result.execution.calls,
            operations: Object.freeze([...result.execution.operations]),
          }
        : {
            kind: result.execution.kind,
            calls: result.execution.calls,
          },
    ),
  });
}

function emitArtifact(
  kind: "input" | "output" | "media.report",
  preview: unknown,
  attributes: Record<string, unknown>,
): CruxArtifactId | undefined {
  return observe.artifact({
    kind,
    contentType: "application/json",
    encoding: "json",
    preview: sanitizeMediaPreview(preview),
    attributes,
  });
}

function linkSpanArtifact(
  spanId: CruxSpanId,
  edgeType: "consumed" | "produced",
  artifactId: CruxArtifactId | undefined,
): void {
  if (!artifactId) return;
  observe.edge({
    edgeType,
    from: { kind: "span", id: spanId },
    to: { kind: "artifact", id: artifactId },
  });
}

function projectMediaFacingValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (key === "raw" || key === "providerMetadata") continue;
    projected[key] = value[key];
  }
  return projected;
}

function describeModel(model: unknown): string | undefined {
  if (typeof model === "object" && model !== null) {
    const record = model as { readonly modelId?: unknown; readonly id?: unknown };
    if (typeof record.modelId === "string") return record.modelId;
    if (typeof record.id === "string") return record.id;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
