/**
 * Deduplicated persistence and retained maintenance for history summaries.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import { resolveDiagnosticsOnlyDeferRegistration } from "../../defer/internal/registration";
import type { RequestWarning } from "../receipt/adaptations";
import type { SummarizeStrategy } from "../history/strategies";
import type {
  HistoryArtifactSpan,
  ThreadHistoryRange,
} from "../history/source";
import {
  historyArtifactIdentity,
  historyPrefixMatches,
  HISTORY_ARTIFACT_GOVERNANCE,
  type HistoryArtifactIdentity,
} from "./identity";
import {
  listHistoryArtifacts,
  publishHistoryArtifact,
  readHistoryArtifact,
  type HistoryArtifactRecord,
} from "./store";

/** Derived summary artifact safe to project with its exact raw suffix. @internal */
export interface HistorySummaryArtifact {
  readonly identity: HistoryArtifactIdentity;
  readonly summary: string;
  readonly supportRequestId?: string;
  readonly supportRequestIds?: readonly string[];
  readonly stale: boolean;
}

/** One provider-backed summary support call. @internal */
export type GenerateHistorySummary = (input: {
  readonly messages: readonly Message[];
  readonly model: unknown;
  readonly strategy: SummarizeStrategy;
  readonly providerNative: boolean;
  readonly purpose?: "history" | "source";
}) => Promise<{
  readonly summary: string;
  readonly requestId?: string;
  readonly requestIds?: readonly string[];
}>;

const inFlight = new Map<string, Promise<HistorySummaryArtifact>>();
const warnedMissingHost = new Set<string>();

/** Find an exact artifact or the freshest valid older prefix. @internal */
export async function findHistorySummaryArtifact(input: {
  readonly prefix: readonly Message[];
  readonly artifactOffset?: number;
  readonly artifactRange?: (span: HistoryArtifactSpan) => ThreadHistoryRange;
  readonly strategy: SummarizeStrategy;
  readonly provider: string;
  readonly model: string;
  readonly providerNative: boolean;
}): Promise<HistorySummaryArtifact | undefined> {
  const wanted = historyIdentity(input);
  const exact = await readHistoryArtifact(wanted.key);
  if (exact) return projectRecord(exact, wanted, false);

  const records = await listHistoryArtifacts(
    `crux:request-summary:v1:${wanted.series}:`,
  );
  const stale = records
    .filter((record) =>
      input.artifactRange
        ? threadPrefixMatches(
            record,
            input.artifactOffset ?? 0,
            input.prefix.length,
            input.artifactRange,
          )
        : historyPrefixMatches(
            input.prefix,
            record.prefixLength,
            record.sourceDigest,
          ),
    )
    .sort((left, right) => right.prefixLength - left.prefixLength)[0];
  if (!stale) return undefined;
  const stalePrefix = input.prefix.slice(0, stale.prefixLength);
  return projectRecord(
    stale,
    historyArtifactIdentity({
      ...input,
      prefix: stalePrefix,
      ...(input.artifactRange
        ? {
            threadRange: input.artifactRange({
              offset: input.artifactOffset ?? 0,
              length: stalePrefix.length,
            }),
          }
        : {}),
    }),
    true,
  );
}

/** Prepare and idempotently publish one exact-prefix artifact. @internal */
export function prepareHistorySummaryArtifact(input: {
  readonly prefix: readonly Message[];
  readonly artifactOffset?: number;
  readonly artifactRange?: (span: HistoryArtifactSpan) => ThreadHistoryRange;
  readonly strategy: SummarizeStrategy;
  readonly provider: string;
  readonly model: string;
  readonly generationModel?: unknown;
  readonly providerNative: boolean;
  readonly generate: GenerateHistorySummary;
}): {
  readonly artifact: Promise<HistorySummaryArtifact>;
  readonly joined: boolean;
} {
  const identity = historyIdentity(input);
  const existing = inFlight.get(identity.id);
  if (existing) return { artifact: existing, joined: true };

  const artifact = (async () => {
    const stored = await readHistoryArtifact(identity.key);
    if (stored) return projectRecord(stored, identity, false);
    const generated = await input.generate({
      messages: input.prefix,
      model: input.generationModel ?? input.model,
      strategy: input.strategy,
      providerNative: input.providerNative,
    });
    const summary = generated.summary.trim();
    if (!summary) {
      throw new TypeError("History summary generation returned empty text.");
    }
    const record: HistoryArtifactRecord = {
      kind: "request.history-summary",
      artifactId: identity.id,
      series: identity.series,
      sourceDigest: identity.sourceDigest,
      prefixLength: identity.prefixLength,
      ...(identity.threadRange
        ? {
            threadSource: identity.threadRange.source,
            threadRevision: identity.threadRange.revision,
            threadRange: identity.threadRange.range,
            threadOffset: identity.threadRange.offset,
            ...(identity.threadRange.start
              ? { threadStart: identity.threadRange.start }
              : {}),
            ...(identity.threadRange.end
              ? { threadEnd: identity.threadRange.end }
              : {}),
          }
        : {}),
      summary,
      createdAt: Date.now(),
      governance: HISTORY_ARTIFACT_GOVERNANCE,
      ...(generated.requestId ? { supportRequestId: generated.requestId } : {}),
      ...(generated.requestIds
        ? { supportRequestIds: generated.requestIds }
        : {}),
    };
    const published = await publishHistoryArtifact(identity.key, record);
    return projectRecord(published, identity, false);
  })().finally(() => {
    inFlight.delete(identity.id);
  });
  inFlight.set(identity.id, artifact);
  return { artifact, joined: false };
}

/** Join an identical preparation without starting new support work. @internal */
export function joinHistorySummaryPreparation(input: {
  readonly prefix: readonly Message[];
  readonly artifactOffset?: number;
  readonly artifactRange?: (span: HistoryArtifactSpan) => ThreadHistoryRange;
  readonly strategy: SummarizeStrategy;
  readonly provider: string;
  readonly model: string;
  readonly generationModel?: unknown;
  readonly providerNative: boolean;
}): Promise<HistorySummaryArtifact> | undefined {
  return inFlight.get(historyIdentity(input).id);
}

/** Schedule post-response preparation through the active retention host. @internal */
export function scheduleHistorySummaryPreparation(input: {
  readonly prefix: readonly Message[];
  readonly artifactOffset?: number;
  readonly artifactRange?: (span: HistoryArtifactSpan) => ThreadHistoryRange;
  readonly strategy: SummarizeStrategy;
  readonly provider: string;
  readonly model: string;
  readonly providerNative: boolean;
  readonly generate: GenerateHistorySummary;
}): {
  readonly warning: RequestWarning;
  readonly retained: boolean;
} {
  const callback = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await prepareHistorySummaryArtifact(input).artifact;
  };
  try {
    const registration = resolveDiagnosticsOnlyDeferRegistration();
    if (!registration) throw new TypeError("No retained defer host.");
    registration.scope.registerInline(callback, {
      ...registration,
      evidence: "diagnostics-only",
    });
    return scheduledWarning(true);
  } catch {
    warnMissingHost(input.model);
    return scheduledWarning(false);
  }
}

function scheduledWarning(retained: boolean): {
  readonly warning: RequestWarning;
  readonly retained: boolean;
} {
  return Object.freeze({
    retained,
    warning: Object.freeze({
      code: retained
        ? "HISTORY_MAINTENANCE_SCHEDULED"
        : "HISTORY_MAINTENANCE_INLINE",
      message: retained
        ? "Summary preparation was retained for post-response maintenance."
        : "No retained defer host was available; summary preparation uses the inline fallback before dispatch.",
    }),
  });
}

function projectRecord(
  record: HistoryArtifactRecord,
  identity: HistoryArtifactIdentity,
  stale: boolean,
): HistorySummaryArtifact {
  return Object.freeze({
    identity,
    summary: record.summary,
    ...(record.supportRequestId
      ? { supportRequestId: record.supportRequestId }
      : {}),
    ...(record.supportRequestIds
      ? { supportRequestIds: record.supportRequestIds }
      : {}),
    stale,
  });
}

function historyIdentity(input: {
  readonly prefix: readonly Message[];
  readonly artifactOffset?: number;
  readonly artifactRange?: (span: HistoryArtifactSpan) => ThreadHistoryRange;
  readonly strategy: SummarizeStrategy;
  readonly provider: string;
  readonly model: string;
  readonly providerNative: boolean;
}): HistoryArtifactIdentity {
  return historyArtifactIdentity({
    prefix: input.prefix,
    ...(input.artifactRange
      ? {
          threadRange: input.artifactRange({
            offset: input.artifactOffset ?? 0,
            length: input.prefix.length,
          }),
        }
      : {}),
    strategy: input.strategy,
    provider: input.provider,
    model: input.model,
    providerNative: input.providerNative,
  });
}

function threadPrefixMatches(
  record: HistoryArtifactRecord,
  offset: number,
  maximumLength: number,
  artifactRange: (span: HistoryArtifactSpan) => ThreadHistoryRange,
): boolean {
  if (
    record.threadSource === undefined ||
    record.threadRange === undefined ||
    record.threadOffset !== offset ||
    record.prefixLength > maximumLength
  ) {
    return false;
  }
  try {
    const current = artifactRange({
      offset,
      length: record.prefixLength,
    });
    return (
      current.source === record.threadSource &&
      current.range === record.threadRange
    );
  } catch {
    return false;
  }
}

function warnMissingHost(model: string): void {
  if (
    warnedMissingHost.has(model) ||
    (typeof process !== "undefined" && process.env.NODE_ENV === "production")
  ) {
    return;
  }
  warnedMissingHost.add(model);
  console.warn(
    "[Crux] Managed history has no retained defer host; summary preparation may add latency. Configure a supported host binding.",
  );
}
