package qualitycmd

// Human renderer for `crux quality progress <evaluation-id>` (spec 03 §1a).
// Turns the backend-owned QualityEvaluationProgress read model into a branded
// header, a one-line summary, and a width-aware recent-runs table with a
// per-row Δ pass-rate arrow. Every styled span funnels through output.IO so
// `--no-color`/non-TTY output stays byte-clean; the --json branch is rendered
// elsewhere (quality_read.go) and is unchanged.

import (
	"fmt"
	"io"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// progressRenderer renders QualityEvaluationProgress to an output.IO. nowFn is
// injectable so relative-time output ("2h ago") is deterministic under test;
// construct one per command via newProgressRenderer.
type progressRenderer struct {
	io    *output.IO
	nowFn func() time.Time
}

func newProgressRenderer(io *output.IO) *progressRenderer {
	return &progressRenderer{io: io, nowFn: time.Now}
}

// render writes the full progress view: header, summary line, and recent-runs
// table. Runs arrive newest-first from the engine; an evaluation with no runs
// still prints a header and an honest "no runs recorded yet" line.
func (r *progressRenderer) render(out io.Writer, p api.QualityEvaluationProgress) {
	fmt.Fprintf(out, "%s  %s\n\n",
		r.io.Sprint(output.BoldCyan, output.LogoMark+" crux quality progress"),
		r.io.Sprint(output.Bold, p.EvaluationID))

	if len(p.Runs) == 0 {
		fmt.Fprintln(out, "  "+r.io.Sprint(output.Dim, "no runs recorded yet"))
		return
	}

	fmt.Fprintf(out, "  %s\n\n", r.summaryLine(p))
	fmt.Fprintln(out, indentLines(r.runsTable(p.Runs), "  "))
}

// summaryLine reports the run count, how long ago the latest run finished, and
// the committed baseline id when the record exposes one (the progress record
// carries only the baseline id, not its source experiment, so we surface the id
// and do not try to mark a run row as the baseline).
func (r *progressRenderer) summaryLine(p api.QualityEvaluationProgress) string {
	latest := p.Runs[0]
	when := relativeFrom(r.nowFn(), nonEmpty(latest.FinishedAt, latest.StartedAt))
	summary := fmt.Sprintf("%d runs · latest %s", len(p.Runs), when)
	if id := progressBaselineID(p); id != "" {
		summary += " · baseline " + r.io.Sprint(output.Accent, id)
	}
	return summary
}

// runsTable renders the recent runs as columns: when · experiment · pass · cost
// · Δ pass. p@k is intentionally absent — QualityEvaluationProgressRun carries
// no per-run consistency field, so the column is omitted rather than invented.
// Δ pass compares each run to the next-older run; the oldest shown run has no
// predecessor and renders an em dash.
func (r *progressRenderer) runsTable(runs []api.QualityEvaluationProgressRun) string {
	table := &output.Table{
		Headers: []string{"when", "experiment", "pass", "cost", "Δ pass"},
		Rows:    make([][]string, 0, len(runs)),
	}
	for i, run := range runs {
		var delta string
		if i+1 < len(runs) {
			delta = r.deltaCell(run.PassRate - runs[i+1].PassRate)
		} else {
			delta = r.io.Sprint(output.Dim, "—")
		}
		table.Rows = append(table.Rows, []string{
			relativeFrom(r.nowFn(), nonEmpty(run.StartedAt, run.FinishedAt)),
			run.ExperimentID,
			r.io.Sprint(passRateStyle(run.PassRate), fmt.Sprintf("%.2f", run.PassRate)),
			optionalCost(run.CostUsd),
			delta,
		})
	}
	return r.io.RenderTable(table)
}

// deltaCell renders a pass-rate delta with a direction arrow, colored green for
// an improvement and red for a regression. A zero delta renders a dim em dash.
func (r *progressRenderer) deltaCell(delta float64) string {
	switch {
	case delta > 0:
		return r.io.Sprint(output.Green, fmt.Sprintf("+%.2f ▲", delta))
	case delta < 0:
		return r.io.Sprint(output.Red, fmt.Sprintf("%.2f ▽", delta))
	default:
		return r.io.Sprint(output.Dim, "—")
	}
}

// progressBaselineID returns the committed baseline id referenced by the score
// series, or "" when no baseline is promoted for the evaluation.
func progressBaselineID(p api.QualityEvaluationProgress) string {
	for _, series := range p.ScoreSeries {
		if series.Baseline != nil && series.Baseline.BaselineID != "" {
			return series.Baseline.BaselineID
		}
	}
	return ""
}

// nonEmpty returns the first non-empty string, or "" when all are empty.
func nonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
