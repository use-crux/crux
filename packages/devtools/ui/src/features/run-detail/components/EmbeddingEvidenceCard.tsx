/** Dedicated, byte-safe presentation for embedding span evidence. */

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Chip } from "@/devtools/shell/primitives";
import type { ObservabilityRunDetailNode } from "@/types";
import {
  projectEmbeddingRunEvidence,
  shortEmbeddingSpaceDigest,
} from "../lib/embedding-run-evidence";
import { fmtDuration, shortModelId } from "../lib/span-detail-inspection";
import { CardShell, EmptyHint } from "./SpanDetailPanelAtoms";

/** Render recognized embedding fields while leaving raw inspection untouched. */
export function EmbeddingEvidenceCard({
  node,
}: {
  readonly node: ObservabilityRunDetailNode;
}) {
  const evidence = projectEmbeddingRunEvidence(node);
  const [copied, setCopied] = useState(false);
  const total = evidence.inputCount;
  const hit = evidence.cacheHitCount;
  const cachePercent =
    hit !== undefined && total ? Math.round((hit / total) * 100) : undefined;
  const stats = runStats(evidence);
  const hasEvidence =
    evidence.role !== undefined ||
    evidence.modalityCounts.length > 0 ||
    evidence.embeddingSpace !== undefined;

  if (!hasEvidence && stats.length === 0 && hit === undefined) {
    return <EmptyHint>No embedding metrics captured for this span.</EmptyHint>;
  }

  const copyDigest = () => {
    if (!evidence.embeddingSpace) return;
    void navigator.clipboard?.writeText(evidence.embeddingSpace);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="flex flex-col gap-4">
      {hasEvidence ? (
        <CardShell
          label="Embedding evidence"
          right={
            evidence.role ? (
              <Chip tone="crux" mono>
                {evidence.role}
              </Chip>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-3 px-3.5 py-3">
            {evidence.modalityCounts.length > 0 ? (
              <div className="flex flex-wrap gap-1.5" aria-label="Modality counts">
                {evidence.modalityCounts.map(({ modality, count }) => (
                  <Chip key={modality} tone="muted" mono>
                    {modality} × {count}
                  </Chip>
                ))}
              </div>
            ) : null}
            {evidence.embeddingSpace ? (
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span style={{ color: "var(--devtools-fg-faint)" }}>
                  space
                </span>
                <code>{shortEmbeddingSpaceDigest(evidence.embeddingSpace)}</code>
                <button
                  type="button"
                  aria-label="Copy full embedding space digest"
                  title={copied ? "Copied" : "Copy full digest"}
                  onClick={copyDigest}
                  className="inline-flex size-6 items-center justify-center rounded-[6px]"
                  style={{
                    color: copied
                      ? "var(--devtools-ok)"
                      : "var(--devtools-fg-muted)",
                    border: "1px solid var(--devtools-border)",
                  }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            ) : null}
          </div>
        </CardShell>
      ) : null}

      {hit !== undefined && total !== undefined && total > 0 ? (
        <CardShell
          label={`Cache · ${hit} / ${total} hit`}
          right={
            cachePercent !== undefined ? (
              <Chip tone="ok" mono>
                {cachePercent}% cached
              </Chip>
            ) : undefined
          }
        >
          <div className="flex h-6 overflow-hidden">
            <div
              className="flex items-center justify-center font-mono text-[9.5px] font-semibold"
              style={{
                width: `${(hit / total) * 100}%`,
                background: "var(--devtools-ok)",
                color: "var(--devtools-bg)",
              }}
            >
              cache {hit}
            </div>
            <div
              className="flex flex-1 items-center justify-center font-mono text-[9.5px] font-semibold"
              style={{
                background: "var(--devtools-crux)",
                color: "var(--devtools-bg)",
              }}
            >
              fresh {total - hit}
            </div>
          </div>
        </CardShell>
      ) : null}

      {stats.length > 0 ? (
        <CardShell label="Run">
          <div
            className="grid gap-2.5 px-3.5 py-3"
            style={{
              gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))`,
            }}
          >
            {stats.map(([label, value]) => (
              <div
                key={label}
                className="rounded-[8px] px-3 py-2.5"
                style={{ border: "1px solid var(--devtools-border)" }}
              >
                <div
                  className="font-mono text-[10px] uppercase tracking-[0.04em]"
                  style={{ color: "var(--devtools-fg-faint)" }}
                >
                  {label}
                </div>
                <div className="mt-0.5 font-mono text-[13px] font-semibold">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </CardShell>
      ) : null}
    </div>
  );
}

function runStats(
  evidence: ReturnType<typeof projectEmbeddingRunEvidence>,
): readonly (readonly [string, string])[] {
  const stats: Array<readonly [string, string]> = [];
  if (evidence.embeddingName) {
    stats.push(["embedding", evidence.embeddingName]);
  }
  if (evidence.model) {
    stats.push(["model", shortModelId(evidence.model) ?? evidence.model]);
  }
  if (evidence.dimensions !== undefined) {
    stats.push(["dimensions", evidence.dimensions.toLocaleString()]);
  }
  if (evidence.truncatedCount !== undefined) {
    stats.push(["truncations", String(evidence.truncatedCount)]);
  }
  if (evidence.rateLimitWaitMs !== undefined) {
    stats.push(["rate-limit wait", fmtDuration(evidence.rateLimitWaitMs)]);
  }
  if (evidence.retryCount !== undefined) {
    stats.push(["retries", String(evidence.retryCount)]);
  }
  return stats;
}
