package qualitycmd

// View layer for `crux quality run`/`show` (spec 02 §1, §4). qualityRenderer
// turns the engine's aggregates and cells into the per-evaluation tree —
// branded header, colored variant rows, cell-failure blocks, and gate lines —
// routing every styled span through output.IO so `--no-color`/non-TTY output
// stays byte-clean. The reporter (quality_reporter.go) drives it from the event
// stream; `quality show` reuses it to render a saved record identically.

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// qualityRenderer renders Quality results to an output.IO. It carries the
// devtools port so trace links resolve to the live server rather than a
// hardcoded one. Construct one per command via newQualityRenderer.
type qualityRenderer struct {
	io   *output.IO
	port int
}

func newQualityRenderer(io *output.IO, port int) *qualityRenderer {
	return &qualityRenderer{io: io, port: port}
}

// evaluation renders one evaluation's full tree to stdout: a branded header,
// the sorted variant rows, replay/comparison provenance, per-cell failures, and
// gates. quiet suppresses passing cells (failures always print). It is a no-op
// until aggregates have arrived (eval:done).
func (r *qualityRenderer) evaluation(state *qualityEvalState, quiet bool) {
	if state.aggregates == nil {
		return
	}
	out := r.io.Out
	id := r.io.Sprint(output.Bold, state.evaluationID)
	caseCount := r.io.Sprint(output.Dim, fmt.Sprintf("%d cases", countDistinctCases(state.cells)))
	header := "\n  " + padCol(id, 50) + " " + caseCount
	if state.filteredRun {
		header += "   " + r.io.Sprint(output.Dim, "gates informational (filtered run)")
	}
	fmt.Fprintln(out, header)

	for _, name := range sortedVariantNames(state.aggregates.PerVariant) {
		r.variantRow(state, name)
	}
	r.replayNotes(state.replay)
	r.comparisonNotes(state.comparison)

	if !quiet || hasFailures(state) {
		for i := range state.cells {
			r.cellFailure(&state.cells[i], "      ")
		}
	}
	if state.gates != nil && len(state.gates.Results) > 0 {
		r.gates(state.gates, state.filteredRun)
	}
}

// variantRow renders one variant line: a status glyph colored by whether every
// cell passed, the variant name, the passed/total counter, a pass-rate token
// colored green at 1.0 / red at 0 / yellow between, the per-score means with a
// dim ±SEM and sign-colored Δ, the mean latency, and cost when non-zero.
func (r *qualityRenderer) variantRow(state *qualityEvalState, name string) {
	aggregate := state.aggregates.PerVariant[name]
	passedAll := aggregate.Failed == 0 && aggregate.Errored == 0

	glyph := r.io.Status(boolStatusKey(passedAll))
	passToken := r.io.Sprint(passRateStyle(aggregate.PassRate), fmt.Sprintf("pass %.2f", aggregate.PassRate))

	line := fmt.Sprintf("  %s %s %2d/%-2d   %s%s   %.1fs",
		glyph,
		padCol(name, 12),
		aggregate.Passed, aggregate.Cells-aggregate.Skipped,
		passToken,
		r.scores(aggregate, variantDeltas(state.comparison, name)),
		aggregate.Latency.MeanMs/1000,
	)
	if aggregate.CostUsd > 0 {
		line += "  " + output.FormatCost(aggregate.CostUsd)
	}
	fmt.Fprintln(r.io.Out, line)
}

// scores renders the non-"pass" score means in sorted order, dimming each ±SEM
// and coloring any comparison Δ green/red by sign so regressions stand out.
func (r *qualityRenderer) scores(aggregate domain.QualityVariantAggregate, deltas map[string]scoreDelta) string {
	names := make([]string, 0, len(aggregate.Scores))
	for name := range aggregate.Scores {
		if name != "pass" {
			names = append(names, name)
		}
	}
	sort.Strings(names)

	var b strings.Builder
	for _, name := range names {
		score := aggregate.Scores[name]
		fmt.Fprintf(&b, "   %s %.2f %s", name, score.Mean, r.io.Sprint(output.Dim, fmt.Sprintf("±%.2f", score.Sem)))
		if d, ok := deltas[name]; ok {
			fmt.Fprintf(&b, "  %s %s",
				r.io.Sprint(deltaStyle(d.mean), fmt.Sprintf("Δ %+.2f", d.mean)),
				r.io.Sprint(output.Dim, fmt.Sprintf("±%.2f", d.sem)))
		}
	}
	return b.String()
}

// cellFailure renders a failed/errored cell's diagnostic block: a red ✗ and the
// case label, each assertion's message with dim Expected/Received/at labels, the
// not-evaluated tally, any runner error with its missing-cassette next step
// (R8), and a clickable trace link per trace id (spec 02 §4). It is a no-op for
// passing or skipped cells.
func (r *qualityRenderer) cellFailure(cell *domain.QualityCell, indent string) {
	if cell.Status != "failed" && cell.Status != "errored" {
		return
	}
	out := r.io.Out
	fmt.Fprintf(out, "%s%s %s %s\n", indent, r.io.Status("error"), cellLabel(cell),
		r.io.Sprint(output.Dim, fmt.Sprintf("(trial %d)", cell.Trial+1)))

	for _, failure := range failedAssertionOutcomes(cell.Assertions.Outcomes) {
		fmt.Fprintf(out, "%s    %s\n", indent, nonEmptyString(failure.Message, failure.Matcher))
		if failure.Expected != nil && failure.Expected.Preview != "" {
			fmt.Fprintf(out, "%s      %s %s\n", indent, r.io.Sprint(output.Dim, "Expected:"), failure.Expected.Preview)
		}
		if failure.Actual != nil && failure.Actual.Preview != "" {
			fmt.Fprintf(out, "%s      %s %s\n", indent, r.io.Sprint(output.Dim, "Received:"), failure.Actual.Preview)
		}
		if failure.SourceRef != "" {
			fmt.Fprintf(out, "%s      %s\n", indent, r.io.Sprint(output.Dim, "at "+failure.SourceRef))
		}
	}
	if cell.Assertions.NotEvaluated > 0 {
		fmt.Fprintf(out, "%s    %s\n", indent,
			r.io.Sprint(output.Dim, fmt.Sprintf("%d ran · %d not evaluated", cell.Assertions.Ran, cell.Assertions.NotEvaluated)))
	}
	if cell.Error != nil {
		fmt.Fprintf(out, "%s    error (%s): %s\n", indent, cell.Error.Phase, cell.Error.Message)
		if cell.Error.MissingCassetteKey != "" {
			fmt.Fprintf(out, "%s      missing cassette key: %s\n", indent, cell.Error.MissingCassetteKey)
			fmt.Fprintf(out, "%s      re-record with: crux quality run %s --replay record-new\n", indent, cell.CaseID)
		}
	}
	if provenance, ok := datasetProvenanceFromCell(cell); ok {
		fmt.Fprintf(out, "%s    %s\n", indent,
			r.io.Sprint(output.Dim, fmt.Sprintf("dataset %s @ %s", provenance.Path, provenance.ContentFingerprint)))
	}
	for _, traceID := range cell.TraceIDs {
		url := fmt.Sprintf("http://localhost:%d/runs/%s", r.port, traceID)
		fmt.Fprintf(out, "%s    trace → %s\n", indent, r.io.Hyperlink(traceID, url, true))
	}
}

type renderedDatasetProvenance struct {
	Path               string `json:"path"`
	ContentFingerprint string `json:"contentFingerprint"`
}

func datasetProvenanceFromCell(cell *domain.QualityCell) (renderedDatasetProvenance, bool) {
	if cell.Metadata == nil || len(*cell.Metadata) == 0 {
		return renderedDatasetProvenance{}, false
	}
	var metadata struct {
		DatasetProvenance renderedDatasetProvenance `json:"datasetProvenance"`
	}
	if err := json.Unmarshal(*cell.Metadata, &metadata); err != nil {
		return renderedDatasetProvenance{}, false
	}
	if metadata.DatasetProvenance.Path == "" || metadata.DatasetProvenance.ContentFingerprint == "" {
		return renderedDatasetProvenance{}, false
	}
	return metadata.DatasetProvenance, true
}

// gates renders the gate results: a bold section label (with an informational
// note when the run was filtered or unbaselined), then one glyph-led line per
// gate with its threshold/actual and a dim informational suffix.
func (r *qualityRenderer) gates(gates *domain.QualityGates, filtered bool) {
	out := r.io.Out
	label := "Gates"
	if filtered || gates.Informational {
		label = "Gates (informational — filtered run)"
	}
	fmt.Fprintf(out, "\n  %s\n", r.io.Sprint(output.Bold, label))
	for _, result := range gates.Results {
		name := result.Gate
		if result.VariantName != "" {
			name += " [" + result.VariantName + "]"
		}
		suffix := ""
		if result.Informational {
			suffix = r.io.Sprint(output.Dim, "   (informational — no blocking baseline)")
		}
		fmt.Fprintf(out, "    %s %s threshold %s · actual %s%s\n",
			r.io.Status(boolStatusKey(result.Passed)), padCol(name, 36),
			formatGateValue(result.Threshold), formatGateValue(result.Actual), suffix)
	}
}

// replayNotes renders cassette provenance for non-live runs (mode, cassette,
// the trials-collapsed note) dim, with a yellow staleness warning.
func (r *qualityRenderer) replayNotes(replay *domain.QualityReplay) {
	if replay == nil || replay.Mode == "" || replay.Mode == "live" {
		return
	}
	out := r.io.Out
	line := "      replay: " + replay.Mode
	if replay.Cassette != "" {
		line += " · cassette " + replay.Cassette
	}
	if replay.TrialsCollapsed {
		line += " (trials collapsed under strict replay)"
	}
	fmt.Fprintln(out, r.io.Sprint(output.Dim, line))
	if replay.StaleSince != "" {
		fmt.Fprintln(out, r.io.Sprint(output.Yellow,
			fmt.Sprintf("      ⚠ cassette recorded %s — older than 90 days, re-record with --replay refresh", replay.StaleSince)))
	}
}

// comparisonNotes renders baseline provenance, drift demotion, and the
// unmatched-case honesty line dim under the variant table.
func (r *qualityRenderer) comparisonNotes(comparison *domain.QualityComparison) {
	if comparison == nil {
		return
	}
	out := r.io.Out
	if comparison.Kind == "promoted" {
		fmt.Fprintf(out, "      %s\n", r.io.Sprint(output.Dim, "compared against promoted baseline "+comparison.Baseline))
	}
	if comparison.Demoted != nil {
		fmt.Fprintf(out, "      %s\n", r.io.Sprint(output.Dim, "comparison informational: "+comparison.Demoted.Reason))
	}
	if len(comparison.UnmatchedCases.BaselineOnly) > 0 || len(comparison.UnmatchedCases.CandidateOnly) > 0 {
		fmt.Fprintf(out, "      %s\n", r.io.Sprint(output.Dim, fmt.Sprintf(
			"unmatched cases excluded from pairing — baseline-only: %s · candidate-only: %s",
			joinOrDash(comparison.UnmatchedCases.BaselineOnly), joinOrDash(comparison.UnmatchedCases.CandidateOnly))))
	}
}
