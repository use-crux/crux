package qualitycmd

// Pure formatting, style-selection, and aggregation helpers for the Quality
// view layer (quality_render.go). Kept free of IO so they are trivially unit-
// testable and reusable by the reporter, renderer, and JUnit writer.

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// scoreDelta is one variant's paired difference for a score (mean ± SEM), kept
// numeric so the renderer can color the sign.
type scoreDelta struct {
	mean float64
	sem  float64
}

// variantDeltas indexes a comparison's deltas for one variant by score name.
func variantDeltas(comparison *domain.QualityComparison, variantName string) map[string]scoreDelta {
	if comparison == nil {
		return nil
	}
	deltas := map[string]scoreDelta{}
	for _, delta := range comparison.Deltas {
		if delta.VariantName != variantName {
			continue
		}
		deltas[delta.ScoreName] = scoreDelta{mean: delta.MeanDelta, sem: delta.Sem}
	}
	return deltas
}

// passRateStyle colors a pass-rate token: green at a perfect rate, red at zero
// (every cell failed), yellow for a partial rate.
func passRateStyle(rate float64) lipgloss.Style {
	switch {
	case rate >= 1.0:
		return output.Green
	case rate <= 0:
		return output.Red
	default:
		return output.Yellow
	}
}

// deltaStyle colors a comparison Δ: green for an improvement, red for a
// regression, dim for no change.
func deltaStyle(delta float64) lipgloss.Style {
	switch {
	case delta > 0:
		return output.Green
	case delta < 0:
		return output.Red
	default:
		return output.Dim
	}
}

// boolStatusKey maps a pass/fail boolean to an output.Status key.
func boolStatusKey(passed bool) string {
	if passed {
		return "success"
	}
	return "error"
}

// sortedVariantNames returns the variant names in deterministic order.
func sortedVariantNames(perVariant map[string]domain.QualityVariantAggregate) []string {
	names := make([]string, 0, len(perVariant))
	for name := range perVariant {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// padCol left-justifies s to width display columns, measuring with
// lipgloss.Width so ANSI-styled and wide-rune cells align like plain ASCII
// (replaces fixed %-Ns verbs that miscount escape sequences).
func padCol(s string, width int) string {
	if pad := width - lipgloss.Width(s); pad > 0 {
		return s + strings.Repeat(" ", pad)
	}
	return s
}

// formatGateValue renders a gate threshold/actual: numbers rounded to two
// decimals (engine float arithmetic would otherwise leak 0.30000000000000004),
// booleans and anything else verbatim.
func formatGateValue(raw json.RawMessage) string {
	var number float64
	if err := json.Unmarshal(raw, &number); err == nil {
		return fmt.Sprintf("%.2f", number)
	}
	return string(raw)
}

func cellLabel(cell *domain.QualityCell) string {
	if cell.CaseName != "" {
		return cell.CaseName
	}
	return cell.CaseID
}

func hasFailures(state *qualityEvalState) bool {
	for i := range state.cells {
		if state.cells[i].Status == "failed" || state.cells[i].Status == "errored" {
			return true
		}
	}
	return false
}

func joinOrDash(items []string) string {
	if len(items) == 0 {
		return "—"
	}
	return strings.Join(items, ", ")
}

func countDistinctCases(cells []domain.QualityCell) int {
	seen := map[string]bool{}
	for i := range cells {
		seen[cells[i].CaseID] = true
	}
	return len(seen)
}
