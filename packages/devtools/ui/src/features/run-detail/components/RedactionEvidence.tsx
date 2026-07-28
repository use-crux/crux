import type { CruxObservabilityRedactionEvidence } from "@use-crux/core/observability";
import type { ObservabilityRunDetailNode } from "@/types";
import {
  formatRedactionSurfaces,
  hasRedactionEvidence,
  REDACTION_EVIDENCE_TOOLTIP,
} from "@/features/observability/lib/redaction-evidence";

/** Compact marker for explicit successful-redaction evidence. */
export function RedactionBadge({
  evidence,
}: {
  evidence?: CruxObservabilityRedactionEvidence;
}) {
  if (!hasRedactionEvidence(evidence)) return null;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{
        color: "var(--devtools-fg-muted)",
        background: "var(--devtools-bg-elev)",
        boxShadow: "inset 0 0 0 1px var(--devtools-border)",
      }}
      title={REDACTION_EVIDENCE_TOOLTIP}
    >
      Redacted
    </span>
  );
}

/** Human-readable, count-free list of affected telemetry surfaces. */
export function AffectedTelemetry({
  evidence,
}: {
  evidence?: CruxObservabilityRedactionEvidence;
}) {
  const labels = formatRedactionSurfaces(evidence);
  if (labels.length === 0) return null;
  return (
    <div>
      <div
        className="text-[9.5px] uppercase tracking-[0.04em]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        Affected telemetry
      </div>
      <div
        className="mt-1 text-[11px] leading-[1.5]"
        style={{ color: "var(--devtools-fg-muted)" }}
      >
        {labels.join(" · ")}
      </div>
    </div>
  );
}

type RunDetailArtifact = ObservabilityRunDetailNode["artifacts"][number];

/** Affected artifact rows with evidence rendered beside each artifact. */
export function RedactedArtifactRows({
  artifacts,
}: {
  artifacts: readonly RunDetailArtifact[];
}) {
  const affected = artifacts.filter((artifact) =>
    hasRedactionEvidence(artifact.redaction),
  );
  if (affected.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {affected.map((artifact) => (
        <div
          key={artifact.artifactId}
          className="flex min-w-0 items-center gap-2"
        >
          <span
            className="min-w-0 flex-1 truncate font-mono text-[10.5px]"
            style={{ color: "var(--devtools-fg-muted)" }}
          >
            {artifact.kind}
          </span>
          <RedactionBadge evidence={artifact.redaction} />
        </div>
      ))}
    </div>
  );
}

/** Count-free tree marker for local or collapsed-descendant evidence. */
export function RedactionDot({ descendant = false }: { descendant?: boolean }) {
  return (
    <span
      aria-label={descendant ? "Descendant telemetry redacted" : "Telemetry redacted"}
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{
        background: descendant
          ? "var(--devtools-fg-faint)"
          : "var(--devtools-fg-muted)",
        boxShadow: descendant
          ? "inset 0 0 0 1px var(--devtools-bg), 0 0 0 1px var(--devtools-fg-faint)"
          : undefined,
      }}
      title={REDACTION_EVIDENCE_TOOLTIP}
    />
  );
}
