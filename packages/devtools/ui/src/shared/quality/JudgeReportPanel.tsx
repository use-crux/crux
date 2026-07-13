/**
 * Shared judge-trust report used by evaluation and scorer features.
 *
 * The view is presentational and SSR-testable. The bound panel owns only the
 * shared Quality read-model query and navigation to an experiment.
 */

import { useNavigation } from "@/app/navigation/useNavigation";
import { Chip, Eyebrow } from "@/qw/shell/primitives";
import { Icon } from "@/qw/shell/Icon";
import { useQualityJudgeReport } from "@/shared/hooks/useQualityApi";
import type { QualityJudgeReport } from "@/types";
import { confusionGrid, formatKappa, formatRate } from "./judge-report-format";

const LABEL_HINT =
  "crux quality label <experiment> --case <case> --verdict pass|fail";

export function JudgeReportPanelView({
  report,
  scorerName,
  loading,
  onOpenExperiment,
}: {
  report: QualityJudgeReport | null | undefined;
  scorerName?: string;
  loading?: boolean;
  onOpenExperiment: (experimentId: string) => void;
}) {
  const scorers = (report?.scorers ?? []).filter(
    (scorer) => !scorerName || scorer.name === scorerName,
  );

  if (loading && !report) {
    return (
      <div
        className="px-4 py-4 font-mono text-[12px]"
        style={{ color: "var(--qw-fg-faint)" }}
      >
        loading judge report…
      </div>
    );
  }

  if (scorers.length === 0) {
    return (
      <div
        className="flex flex-col gap-2 rounded-[10px] px-4 py-4 text-[12.5px]"
        style={{
          border: "1px dashed var(--qw-border)",
          color: "var(--qw-fg-muted)",
        }}
      >
        <span>
          No human labels yet — label a few cells to measure judge trust.
        </span>
        <code
          className="font-mono text-[11px]"
          style={{ color: "var(--qw-fg-faint)" }}
        >
          {LABEL_HINT}
        </code>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {scorers.map((scorer) => (
        <div
          key={scorer.name}
          className="flex flex-col gap-3 rounded-[12px] px-4 py-4"
          style={{
            background: "var(--qw-bg-elev)",
            border: "1px solid var(--qw-border)",
          }}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <Icon name="sparkle" size={15} color="var(--qw-gold)" />
            <span className="font-mono text-[13px] font-semibold">
              {scorer.name}
            </span>
            <Chip tone="muted" mono>
              floor {scorer.threshold.toFixed(2)}
            </Chip>
            <span
              className="ml-auto font-mono text-[11px]"
              style={{ color: "var(--qw-fg-muted)" }}
            >
              {scorer.labeled} labeled
            </span>
          </div>

          <div className="flex flex-wrap gap-4 font-mono text-[11.5px]">
            <Stat label="agreement" value={formatRate(scorer.agreement)} />
            <Stat label="precision" value={formatRate(scorer.precision)} />
            <Stat label="recall" value={formatRate(scorer.recall)} />
            <Stat label="kappa" value={formatKappa(scorer.kappa)} />
          </div>

          <div className="grid grid-cols-2 gap-1.5" style={{ maxWidth: 380 }}>
            {confusionGrid(scorer.confusion).map((cell) => (
              <div
                key={cell.key}
                className="flex flex-col gap-0.5 rounded-[8px] px-3 py-2"
                style={{
                  background: cell.agree
                    ? "var(--qw-ok-soft)"
                    : "var(--qw-danger-soft)",
                  boxShadow: `inset 0 0 0 1px ${cell.agree ? "var(--qw-ok-line)" : "var(--qw-danger-line)"}`,
                }}
              >
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.06em]"
                  style={{ color: "var(--qw-fg-faint)" }}
                >
                  {cell.label}
                </span>
                <span className="text-[16px] font-semibold">{cell.count}</span>
              </div>
            ))}
          </div>

          {scorer.disagreements.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Eyebrow>Disagreements · {scorer.disagreements.length}</Eyebrow>
              {scorer.disagreements.map((disagreement, index) => (
                <button
                  key={`${disagreement.experimentId}:${disagreement.caseId}:${disagreement.variant}:${disagreement.trial}:${index}`}
                  onClick={() => onOpenExperiment(disagreement.experimentId)}
                  className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left font-mono text-[11px]"
                  style={{
                    background: "var(--qw-bg-muted)",
                    color: "var(--qw-fg-muted)",
                    cursor: "pointer",
                  }}
                >
                  <Chip tone={disagreement.human === "pass" ? "ok" : "danger"}>
                    human {disagreement.human}
                  </Chip>
                  <span>judge {disagreement.judgeScore.toFixed(2)}</span>
                  <span className="truncate" style={{ color: "var(--qw-fg)" }}>
                    {disagreement.caseId} · {disagreement.variant}
                  </span>
                  <Icon
                    name="arrowRight"
                    size={11}
                    className="ml-auto"
                    color="var(--qw-fg-faint)"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span style={{ color: "var(--qw-fg-faint)" }}>{label}</span>
      <b style={{ color: "var(--qw-fg)" }}>{value}</b>
    </span>
  );
}

/** Render judge trust for one evaluation, optionally scoped to one scorer. */
export function JudgeReportPanel({
  evaluationId,
  scorerName,
}: {
  evaluationId: string;
  scorerName?: string;
}) {
  const { navigate } = useNavigation();
  const { data: report, loading } = useQualityJudgeReport(evaluationId);
  return (
    <JudgeReportPanelView
      report={report}
      scorerName={scorerName}
      loading={loading}
      onOpenExperiment={(experimentId) =>
        navigate({ view: "experiment-detail", experimentId })
      }
    />
  );
}
