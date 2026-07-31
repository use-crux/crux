/**
 * Content-addressed identity for derived request artifacts.
 *
 * @module
 */

import { sha256Hex } from "../../content/sha256";
import type { Message } from "../../generation/messages";
import type { SummarizeStrategy } from "../history/strategies";
import type { ThreadHistoryRange } from "../history/source";

const encoder = new TextEncoder();
const ARTIFACT_PROMPT_VERSION = "history-summary-v1";
const ARTIFACT_POLICY_VERSION = "managed-history-v1";

/** Conservative policy inherited by manual-history artifacts. @internal */
export const HISTORY_ARTIFACT_GOVERNANCE = Object.freeze({
  sensitivity: "restricted",
  tenancy: "storage-scope",
  residency: "storage-provider",
  ownership: "storage-scope",
  retentionMs: 5 * 60_000,
});

/** Opaque identity facts for one exact manual-history prefix. @internal */
export interface HistoryArtifactIdentity {
  readonly id: string;
  readonly key: string;
  readonly series: string;
  readonly sourceDigest: string;
  readonly prefixLength: number;
  readonly threadRange?: ThreadHistoryRange;
}

/** Build content-addressed identity without exposing source content. @internal */
export function historyArtifactIdentity(input: {
  readonly prefix: readonly Message[];
  readonly threadRange?: ThreadHistoryRange;
  readonly strategy: SummarizeStrategy;
  readonly provider: string;
  readonly model: string;
  readonly providerNative: boolean;
}): HistoryArtifactIdentity {
  const sourceDigest = input.threadRange
    ? digest({ kind: "thread", ...input.threadRange })
    : digestMessages(input.prefix);
  const series = digest({
    kind: "history-summary",
    source: input.threadRange
      ? { kind: "thread", identity: input.threadRange.source }
      : { kind: "manual" },
    strategy: `${input.strategy.kind}:v${input.strategy.version}`,
    provider: input.provider,
    model: input.model,
    lowering: input.providerNative ? "native-allowed" : "portable-only",
    prompt: ARTIFACT_PROMPT_VERSION,
    policy: ARTIFACT_POLICY_VERSION,
    governance: HISTORY_ARTIFACT_GOVERNANCE,
  });
  const id = digest({
    series,
    ...(input.threadRange
      ? { threadRevision: input.threadRange.revision, range: input.threadRange }
      : { sourceDigest }),
    prefixLength: input.prefix.length,
  });
  return Object.freeze({
    id: `history_summary_${id}`,
    key: `crux:request-summary:v1:${series}:${id}`,
    series,
    sourceDigest,
    prefixLength: input.prefix.length,
    ...(input.threadRange ? { threadRange: input.threadRange } : {}),
  });
}

/** Return whether messages still begin with an artifact's exact prefix. @internal */
export function historyPrefixMatches(
  messages: readonly Message[],
  prefixLength: number,
  sourceDigest: string,
): boolean {
  return (
    prefixLength > 0 &&
    messages.length >= prefixLength &&
    digestMessages(messages.slice(0, prefixLength)) === sourceDigest
  );
}

function digestMessages(messages: readonly Message[]): string {
  return digest(messages);
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
