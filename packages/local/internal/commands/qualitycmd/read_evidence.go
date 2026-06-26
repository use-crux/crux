package qualitycmd

// Human renderer for `crux quality cell-evidence <experiment-id>` (spec 03
// §1b). Turns the joined QualityCellEvidence read model into a branded header,
// a one-line cell identity, and Scores / Assertions / Error / Signals / Trace
// sections — each rendered only when the record carries that data. Every styled
// span funnels through output.IO for color gating; trace links resolve to the
// devtools port via io.Hyperlink. The --json branch (quality_read.go) is
// unchanged.

import (
	"fmt"
	"io"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// cellEvidenceRenderer renders QualityCellEvidence to an output.IO. It carries
// the devtools port so trace links resolve to the live server; construct one
// per command via newCellEvidenceRenderer.
type cellEvidenceRenderer struct {
	io   *output.IO
	port int
}

func newCellEvidenceRenderer(io *output.IO, port int) *cellEvidenceRenderer {
	return &cellEvidenceRenderer{io: io, port: port}
}

// render writes the full evidence view for one cell.
func (r *cellEvidenceRenderer) render(out io.Writer, e api.QualityCellEvidence) {
	fmt.Fprintf(out, "%s  %s\n\n",
		r.io.Sprint(output.BoldCyan, output.LogoMark+" crux quality cell-evidence"),
		r.io.Sprint(output.Bold, e.ExperimentID))

	r.identityLine(out, e.Cell)
	r.scoresSection(out, e.Scores)
	r.assertionsSection(out, e.Assertions)
	r.errorSection(out, e.Cell)
	r.signalsSection(out, e.Cell.CapturedSignals)
	r.traceSection(out, e.Cell.TraceIDs)
}

// identityLine renders the case/variant/trial identity with a colored status
// glyph, duration, and cost when present.
func (r *cellEvidenceRenderer) identityLine(out io.Writer, cell api.QualityCellIdentity) {
	label := cell.CaseID
	if cell.CaseName != "" {
		label = cell.CaseName
	}
	line := fmt.Sprintf("  case %s / variant %s / trial %d   %s %s   %s",
		label, cell.VariantName, cell.Trial,
		r.io.Status(cellStatusKey(cell.Status)),
		cell.Status,
		output.FormatDuration(cell.DurationMs))
	if cost := optionalCost(cell.CostUsd); cost != "" {
		line += "   " + cost
	}
	fmt.Fprintln(out, line)
}

// scoresSection renders each numeric score with a glyph (its threshold verdict
// when present), value, threshold expectation, and any baseline delta. Omitted
// when the record carries no scores.
func (r *cellEvidenceRenderer) scoresSection(out io.Writer, scores []api.QualityScoreEvidence) {
	if len(scores) == 0 {
		return
	}
	fmt.Fprintf(out, "\n  %s\n", r.io.Sprint(output.Bold, "Scores"))
	for _, score := range scores {
		glyph := r.io.Sprint(output.Dim, "·")
		if score.Threshold != nil {
			glyph = r.io.Status(boolStatusKey(score.Threshold.Passed))
		}
		line := fmt.Sprintf("    %s %s %s", glyph,
			padCol(score.Name, 18), fmt.Sprintf("%.2f", score.Score))
		if note := scoreExpectation(score); note != "" {
			line += "   " + r.io.Sprint(output.Dim, note)
		}
		if score.DeltaFromBaseline != nil {
			line += "  " + r.io.Sprint(deltaStyle(*score.DeltaFromBaseline),
				fmt.Sprintf("Δ %+.2f", *score.DeltaFromBaseline))
		}
		fmt.Fprintln(out, line)
	}
}

// assertionsSection renders the assertion ledger summary and each non-passing
// outcome with its dim Expected/Received/at block. Omitted when no assertions
// ran and none were recorded.
func (r *cellEvidenceRenderer) assertionsSection(out io.Writer, assertions api.QualityAssertionEvidence) {
	if assertions.Ran == 0 && len(assertions.Outcomes) == 0 {
		return
	}
	summary := fmt.Sprintf("%d ran · %d failed", assertions.Ran, countFailedOutcomes(assertions.Outcomes))
	if assertions.NotEvaluated > 0 {
		summary += fmt.Sprintf(" · %d not evaluated", assertions.NotEvaluated)
	}
	fmt.Fprintf(out, "\n  %s   %s\n", r.io.Sprint(output.Bold, "Assertions"), r.io.Sprint(output.Dim, summary))

	for i := range assertions.Outcomes {
		outcome := &assertions.Outcomes[i]
		if outcome.Status == "passed" || outcome.Status == "skipped" {
			continue
		}
		fmt.Fprintf(out, "    %s %s\n", r.io.Status("error"), assertionTitle(outcome))
		if expected := outcomeExpected(outcome); expected != "" {
			fmt.Fprintf(out, "        %s %s\n", r.io.Sprint(output.Dim, "Expected:"), expected)
		}
		if actual := outcomeActual(outcome); actual != "" {
			fmt.Fprintf(out, "        %s %s\n", r.io.Sprint(output.Dim, "Received:"), actual)
		}
		if ref := outcomeSourceRef(outcome); ref != "" {
			fmt.Fprintf(out, "        %s\n", r.io.Sprint(output.Dim, "at "+ref))
		}
	}
}

// errorSection renders a runner error with its phase, message, and the
// missing-cassette re-record next step (R8). Omitted when the cell has no error.
func (r *cellEvidenceRenderer) errorSection(out io.Writer, cell api.QualityCellIdentity) {
	if cell.Error == nil {
		return
	}
	fmt.Fprintf(out, "\n  %s\n", r.io.Sprint(output.Bold, "Error"))
	fmt.Fprintf(out, "    %s %s\n", r.io.Sprint(output.Dim, "("+cell.Error.Phase+")"), cell.Error.Message)
	if cell.Error.MissingCassetteKey != "" {
		fmt.Fprintf(out, "    %s\n", r.io.Sprint(output.Dim, "missing cassette key: "+cell.Error.MissingCassetteKey))
		fmt.Fprintf(out, "    %s\n", r.io.Sprint(output.Dim,
			"re-record with: crux quality run "+cell.CaseID+" --replay record-new"))
	}
}

// signalsSection lists the captured signal names. Omitted when none were
// captured.
func (r *cellEvidenceRenderer) signalsSection(out io.Writer, signals []string) {
	if len(signals) == 0 {
		return
	}
	fmt.Fprintf(out, "\n  %s   %s\n", r.io.Sprint(output.Bold, "Signals"), strings.Join(signals, ", "))
}

// traceSection renders a clickable devtools deep link per trace id. Omitted
// when the cell retained no traces.
func (r *cellEvidenceRenderer) traceSection(out io.Writer, traceIDs []string) {
	if len(traceIDs) == 0 {
		return
	}
	fmt.Fprintf(out, "\n  %s\n", r.io.Sprint(output.Bold, "Trace"))
	for _, traceID := range traceIDs {
		url := fmt.Sprintf("http://localhost:%d/runs/%s", r.port, traceID)
		fmt.Fprintf(out, "    trace → %s\n", r.io.Hyperlink(traceID, url, true))
	}
}

// ── pure mappers over the evidence record ─────────────────────────

// scoreExpectation renders a score's threshold expectation ("expected ≥ 1.00")
// or, lacking a threshold, its descriptive label.
func scoreExpectation(score api.QualityScoreEvidence) string {
	if score.Threshold != nil {
		return fmt.Sprintf("(expected %s %.2f)",
			thresholdOperatorSymbol(score.Threshold.Operator), score.Threshold.Value)
	}
	if score.Label != "" {
		return "(" + score.Label + ")"
	}
	return ""
}

// countFailedOutcomes counts the assertion outcomes that did not pass or skip.
func countFailedOutcomes(outcomes []api.QualityAssertionOutcome) int {
	failed := 0
	for i := range outcomes {
		switch outcomes[i].Status {
		case "passed", "skipped", "":
		default:
			failed++
		}
	}
	return failed
}

// assertionTitle prefers the matcher name, falling back to the outcome message
// or a generic label so a failed assertion always names what failed.
func assertionTitle(outcome *api.QualityAssertionOutcome) string {
	if outcome.Matcher != "" {
		return outcome.Matcher
	}
	if outcome.Message != "" {
		return outcome.Message
	}
	return "assertion failed"
}

// outcomeExpected/outcomeActual prefer the structured value preview, falling
// back to the empty string so an absent side renders no line.
func outcomeExpected(outcome *api.QualityAssertionOutcome) string {
	if outcome.Expected != nil {
		return outcome.Expected.Preview
	}
	return ""
}

func outcomeActual(outcome *api.QualityAssertionOutcome) string {
	if outcome.Actual != nil {
		return outcome.Actual.Preview
	}
	return ""
}

// outcomeSourceRef prefers the explicit source ref, then the authored frame's
// file:line, so a failure always points at its assertion site when known.
func outcomeSourceRef(outcome *api.QualityAssertionOutcome) string {
	if outcome.SourceRef != "" {
		return outcome.SourceRef
	}
	if frame := outcome.SourceFrame; frame != nil {
		if frame.AuthoredFile != "" {
			if frame.AuthoredLine > 0 {
				return fmt.Sprintf("%s:%d", frame.AuthoredFile, frame.AuthoredLine)
			}
			return frame.AuthoredFile
		}
		if frame.SourceRef != "" {
			return frame.SourceRef
		}
	}
	return ""
}
