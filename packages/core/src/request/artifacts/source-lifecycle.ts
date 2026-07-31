/**
 * Content-addressed lifecycle for non-history source summaries.
 *
 * @module
 */

import { sha256Hex } from "../../content/sha256";
import type { Message } from "../../generation/messages";
import { getHooks } from "../../runtime/runtime";
import { resolveDiagnosticsOnlyDeferRegistration } from "../../defer/internal/registration";
import type { JsonObject, RecordStore } from "../../storage/types";
import type { SummarizeStrategy } from "../history/strategies";
import type { GenerateHistorySummary } from "./lifecycle";
import { HISTORY_ARTIFACT_GOVERNANCE } from "./identity";

const encoder = new TextEncoder();
const PROMPT_VERSION = "source-summary-v1";
const inFlight = new Map<string, Promise<SourceSummaryArtifact>>();

interface SourceSummaryRecord extends JsonObject {
  readonly kind: "request.source-summary";
  readonly artifactId: string;
  readonly sourceDigest: string;
  readonly summary: string;
  readonly createdAt: number;
  readonly supportRequestId?: string;
  readonly supportRequestIds?: readonly string[];
}

/** Prepared summary projection for one exact non-history source. @internal */
export interface SourceSummaryArtifact {
  readonly summary: string;
  readonly supportRequestId?: string;
  readonly supportRequestIds?: readonly string[];
}

/** Read one valid content-addressed source summary without preparing it. @internal */
export async function findSourceSummaryArtifact(input: {
  readonly sourceTexts: readonly string[];
  readonly strategy: SummarizeStrategy;
  readonly provider: string;
  readonly model: string;
}): Promise<SourceSummaryArtifact | undefined> {
  const stored = await readRecord(sourceIdentity(input).key);
  return stored ? projectRecord(stored) : undefined;
}

/** Read or prepare one content-addressed source summary. @internal */
export async function sourceSummaryArtifact(input: {
  readonly sourceTexts: readonly string[];
  readonly strategy: SummarizeStrategy;
  readonly provider: string;
  readonly model: string;
  readonly generationModel?: unknown;
  readonly generate: GenerateHistorySummary;
}): Promise<SourceSummaryArtifact> {
  const identity = sourceIdentity(input);
  const stored = await readRecord(identity.key);
  if (stored) return projectRecord(stored);
  const existing = inFlight.get(identity.id);
  if (existing) return existing;
  const pending = prepareSourceSummary(input, identity).finally(() => {
    inFlight.delete(identity.id);
  });
  inFlight.set(identity.id, pending);
  return pending;
}

/** Retain source-summary preparation after successful response completion. @internal */
export function scheduleSourceSummaryArtifact(
  input: Parameters<typeof sourceSummaryArtifact>[0],
): boolean {
  const registration = resolveDiagnosticsOnlyDeferRegistration();
  if (!registration) return false;
  registration.scope.registerInline(
    async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await sourceSummaryArtifact(input);
    },
    {
      ...registration,
      evidence: "diagnostics-only",
    },
  );
  return true;
}

async function prepareSourceSummary(
  input: Parameters<typeof sourceSummaryArtifact>[0],
  identity: ReturnType<typeof sourceIdentity>,
): Promise<SourceSummaryArtifact> {
  const messages: readonly Message[] = [{
    role: "user",
    content: input.sourceTexts.join("\n\n"),
  }];
  const generated = await input.generate({
    messages,
    model: input.generationModel ?? input.model,
    strategy: input.strategy,
    providerNative: false,
    purpose: "source",
  });
  const summary = generated.summary.trim();
  if (!summary) {
    throw new TypeError("Source summary generation returned empty text.");
  }
  const record: SourceSummaryRecord = {
    kind: "request.source-summary",
    artifactId: identity.id,
    sourceDigest: identity.sourceDigest,
    summary,
    createdAt: Date.now(),
    ...(generated.requestId
      ? { supportRequestId: generated.requestId }
      : {}),
    ...(generated.requestIds
      ? { supportRequestIds: generated.requestIds }
      : {}),
  };
  await writeRecord(identity.key, record);
  return projectRecord(record);
}

function sourceIdentity(input: {
  readonly sourceTexts: readonly string[];
  readonly strategy: SummarizeStrategy;
  readonly provider: string;
  readonly model: string;
}): {
  readonly id: string;
  readonly key: string;
  readonly sourceDigest: string;
} {
  const sourceDigest = digest(input.sourceTexts);
  const id = digest({
    sourceDigest,
    strategy: `${input.strategy.kind}:v${input.strategy.version}`,
    provider: input.provider,
    model: input.model,
    prompt: PROMPT_VERSION,
    governance: HISTORY_ARTIFACT_GOVERNANCE,
  });
  return Object.freeze({
    id: `source_summary_${id}`,
    key: `crux:request-summary:v1:source:${id}`,
    sourceDigest,
  });
}

async function readRecord(
  key: string,
): Promise<SourceSummaryRecord | undefined> {
  const value = configuredRecords()
    ? await configuredRecords()!.get(key)
    : undefined;
  return isSourceSummaryRecord(value) ? value : undefined;
}

async function writeRecord(
  key: string,
  value: SourceSummaryRecord,
): Promise<void> {
  const records = configuredRecords();
  if (!records) return;
  if (records.create) {
    await records.create(key, value, {
      ttlMs: HISTORY_ARTIFACT_GOVERNANCE.retentionMs,
    });
    return;
  }
  await records.put(key, value, {
    ttlMs: HISTORY_ARTIFACT_GOVERNANCE.retentionMs,
  });
}

function configuredRecords(): RecordStore | undefined {
  return getHooks().records;
}

function projectRecord(record: SourceSummaryRecord): SourceSummaryArtifact {
  return Object.freeze({
    summary: record.summary,
    ...(record.supportRequestId
      ? { supportRequestId: record.supportRequestId }
      : {}),
    ...(record.supportRequestIds
      ? { supportRequestIds: record.supportRequestIds }
      : {}),
  });
}

function isSourceSummaryRecord(
  value: JsonObject | null | undefined,
): value is SourceSummaryRecord {
  return (
    value?.kind === "request.source-summary" &&
    typeof value.artifactId === "string" &&
    typeof value.sourceDigest === "string" &&
    typeof value.summary === "string" &&
    typeof value.createdAt === "number"
  );
}

function digest(value: unknown): string {
  return sha256Hex(encoder.encode(canonicalJson(value)));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
