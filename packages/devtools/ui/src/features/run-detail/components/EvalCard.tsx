import type { CruxScoreReportPreview } from "@use-crux/core/observability";
import type { ObservabilityRunDetailNode } from "@/types";
import { Chip, ScoreBar } from "@/devtools/shell/primitives";
import { JsonTree } from "@/shared/components/JsonTree";
import { findArtifact } from "../lib/span-detail-inspection";
import { EvalTimeoutCard } from "./EvalTimeoutCard";
import { CardShell, EmptyHint } from "./SpanDetailPanelAtoms";

function isScoreReport(
  preview: unknown,
): preview is CruxScoreReportPreview {
  return (
    typeof preview === "object" &&
    preview !== null &&
    (preview as { kind?: unknown }).kind === "score.report"
  );
}

/** Render one Eval Case verdict or its structured cancellation terminal. */
export function EvalCard({ node }: { node: ObservabilityRunDetailNode }) {
  if (node.primitive === "eval.case" && node.status === "cancelled") {
    return <EvalTimeoutCard node={node} />;
  }

  const raw = findArtifact(node, "score.report")?.preview;
  if (!isScoreReport(raw)) {
    return (
      <EmptyHint>No verdict / judge report recorded for this case.</EmptyHint>
    );
  }
  const verdict = raw.verdict;
  const pass = verdict === "pass";
  const judges = raw.judges ?? [];

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        label="Verdict"
        right={
          raw.primaryFailureType ? (
            <span style={{ color: "var(--devtools-danger)" }}>
              {raw.primaryFailureType}
            </span>
          ) : undefined
        }
      >
        <div className="flex items-center gap-3 px-3.5 py-3">
          <Chip tone={pass ? "ok" : verdict ? "danger" : "muted"} dot>
            {verdict != null ? String(verdict) : "—"}
          </Chip>
          {raw.score != null && (
            <span className="font-mono text-[13px] font-semibold">
              {raw.score.toFixed(2)}
            </span>
          )}
          {raw.reasoningPreview && (
            <span
              className="flex-1 text-[12px]"
              style={{ color: "var(--devtools-fg-muted)" }}
            >
              {raw.reasoningPreview}
            </span>
          )}
        </div>
      </CardShell>

      {judges.length > 0 && (
        <CardShell label={`Judges · ${judges.length}`}>
          <div className="flex flex-col gap-2.5 px-3.5 py-3">
            {judges.map((judge) => {
              const ok =
                judge.status === "passed" ||
                (judge.score != null &&
                  judge.threshold != null &&
                  judge.score >= judge.threshold);
              const color = ok ? "var(--devtools-ok)" : "var(--devtools-warn)";
              return (
                <div key={judge.name}>
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className="flex-1 truncate font-mono text-[11.5px]"
                      style={{ color: "var(--devtools-fg)" }}
                    >
                      {judge.name}
                    </span>
                    {judge.score != null && (
                      <span
                        className="font-mono text-[11.5px] font-semibold"
                        style={{ color }}
                      >
                        {judge.score.toFixed(2)}
                        {judge.threshold != null && (
                          <span style={{ color: "var(--devtools-fg-faint)" }}>
                            {" "}
                            / {judge.threshold.toFixed(2)}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {judge.score != null && (
                    <ScoreBar
                      score={judge.score}
                      threshold={judge.threshold}
                      color={color}
                    />
                  )}
                  {judge.rationale && (
                    <div
                      className="mt-1 text-[11.5px] leading-[1.5]"
                      style={{ color: "var(--devtools-fg-muted)" }}
                    >
                      {judge.rationale}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardShell>
      )}

      {(raw.expected !== undefined || raw.actual !== undefined) && (
        <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <CardShell label="Expected">
            <div className="px-3.5 py-3">
              {raw.expected !== undefined ? (
                <JsonTree data={raw.expected} />
              ) : (
                <span>—</span>
              )}
            </div>
          </CardShell>
          <CardShell label="Actual">
            <div className="px-3.5 py-3">
              {raw.actual !== undefined ? (
                <JsonTree data={raw.actual} />
              ) : (
                <span>—</span>
              )}
            </div>
          </CardShell>
        </div>
      )}
    </div>
  );
}
