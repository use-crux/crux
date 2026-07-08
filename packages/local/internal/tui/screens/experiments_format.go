package screens

import (
	"fmt"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func newExperimentsTable() *kit.Table[api.QualityExperimentSummary] {
	return kit.NewTable([]kit.Col[api.QualityExperimentSummary]{
		{Title: "id", C: kit.Ratio(1, 5), Value: func(e api.QualityExperimentSummary) string {
			prefix := " "
			if e.Status == "running" {
				prefix = "◆"
			}
			return prefix + " " + shortID(e.ExperimentID, 8)
		}},
		{Title: "flow", C: kit.Ratio(1, 4), Value: func(e api.QualityExperimentSummary) string {
			return e.EvaluationID
		}},
		{Title: "dataset", C: kit.Ratio(1, 5), Value: func(e api.QualityExperimentSummary) string {
			if e.ExperimentLabel != "" {
				return e.ExperimentLabel
			}
			return e.QualityID
		}},
		{Title: "pass", C: kit.Ratio(1, 6), Align: kit.AlignRight, Value: func(e api.QualityExperimentSummary) string {
			if e.Status == "running" {
				return "-"
			}
			if e.Cells <= 0 {
				return "-"
			}
			return fmt.Sprintf("%.0f%%", float64(e.CellsPassed)*100/float64(e.Cells))
		}},
		{Title: "ago", C: kit.Fill(), Align: kit.AlignRight, Value: func(e api.QualityExperimentSummary) string {
			return relTime(e.StartedAt)
		}},
	})
}

func (s *Experiments) isRunning() bool {
	cur := s.currentSummary()
	return cur != nil && cur.Status == "running"
}

func runningProgress(summary *api.QualityExperimentSummary) (done int, total int) {
	if summary == nil {
		return 0, 0
	}
	variants := len(summary.Variants)
	if variants <= 0 {
		variants = 1
	}
	total = summary.Cells / variants
	if total <= 0 {
		total = summary.Cells
	}
	done = summary.CellsPassed / variants
	if done <= 0 && summary.CellsPassed > 0 {
		done = summary.CellsPassed
	}
	return done, total
}

func progressFrac(done, total int) float64 {
	if total <= 0 {
		return 0
	}
	return float64(done) / float64(total)
}

func (s *Experiments) variantMetrics() []kit.VariantMetrics {
	if s.detail == nil {
		return nil
	}
	names := s.variantOrder()
	winner := s.winnerVariant()
	basePass := 0.0
	if base := s.baselineVariant(); base != "" {
		basePass = aggregatePass(s.detail.Aggregates.PerVariant[base])
	}
	out := make([]kit.VariantMetrics, 0, len(names))
	for _, name := range names {
		agg, ok := s.detail.Aggregates.PerVariant[name]
		if !ok {
			continue
		}
		out = append(out, kit.VariantMetrics{
			Name:     name,
			Pass:     agg.PassRate,
			Score:    primaryScore(agg),
			Tokens:   avgTokens(agg),
			Latency:  fmt.Sprintf("%.1fs", agg.Latency.P95Ms/1000),
			Cost:     formatCost(agg.CostUsd),
			Delta:    deltaPass(agg.PassRate, basePass),
			Baseline: name == s.baselineVariant(),
			Winner:   name == winner,
		})
	}
	return out
}

func (s *Experiments) variantOrder() []string {
	if s.detail == nil {
		return nil
	}
	names := make([]string, 0, len(s.detail.Variants))
	for _, variant := range s.detail.Variants {
		names = append(names, variant.Name)
	}
	extra := make([]string, 0)
	for name := range s.detail.Aggregates.PerVariant {
		if !containsString(names, name) {
			extra = append(extra, name)
		}
	}
	sort.Strings(extra)
	return append(names, extra...)
}

func (s *Experiments) baselineVariant() string {
	if s.detail == nil {
		return ""
	}
	if s.detail.BaselineRef != nil && s.detail.BaselineRef.VariantName != "" {
		return s.detail.BaselineRef.VariantName
	}
	if len(s.detail.Variants) > 0 {
		return s.detail.Variants[0].Name
	}
	return ""
}

func (s *Experiments) winnerVariant() string {
	if s.detail == nil {
		return ""
	}
	return bestExperimentVariant(*s.detail)
}

func (s *Experiments) detailAggregates() map[string]api.QualityVariantAggregate {
	if s.detail == nil || s.detail.Aggregates.PerVariant == nil {
		return nil
	}
	return s.detail.Aggregates.PerVariant
}

func (s *Experiments) promotionCallout(width int) string {
	winner := s.winnerVariant()
	if winner == "" || s.detail == nil {
		return ""
	}
	agg := s.detail.Aggregates.PerVariant[winner]
	base := s.detail.Aggregates.PerVariant[s.baselineVariant()]
	passDelta := (agg.PassRate - base.PassRate) * 100
	costNote := "-2.6x cost"
	if agg.CostUsd != nil && base.CostUsd != nil && *agg.CostUsd > 0 {
		costNote = fmt.Sprintf("-%.1fx cost", *base.CostUsd / *agg.CostUsd)
	}
	text := fmt.Sprintf(" ▸ %s is promotion-ready - %+.0f pt pass · %s · %.1fs p95", winner, passDelta, costNote, agg.Latency.P95Ms/1000)
	return padRow(experimentsStyles.Green.Render(text), width)
}

func (s *Experiments) variantDiffLines() []kit.DiffLine {
	if s.detail == nil {
		return nil
	}
	winner := s.winnerVariant()
	base := s.baselineVariant()
	variantByName := map[string]api.QualityExperimentVariantDecl{}
	for _, variant := range s.detail.Variants {
		variantByName[variant.Name] = variant
	}
	lines := []kit.DiffLine{{Kind: " ", Text: base + " -> " + winner}}
	overrides := variantByName[winner].Overrides
	keys := make([]string, 0, len(overrides))
	for key := range overrides {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		lines = append(lines, kit.DiffLine{Kind: "+", Text: fmt.Sprintf("%s: %v", key, overrides[key])})
	}
	if len(lines) == 1 {
		lines = append(lines, kit.DiffLine{Kind: " ", Text: "(winner has no config override)"})
	}
	return lines
}

func (s *Experiments) failingCells() []api.QualityExperimentCell {
	if s.detail == nil {
		return nil
	}
	out := make([]api.QualityExperimentCell, 0)
	for _, cell := range s.detail.Cells {
		switch cell.Status {
		case "passed", "skipped":
			continue
		default:
			out = append(out, cell)
		}
	}
	return out
}

func (s *Experiments) failingCellLines(width int) []string {
	cells := s.failingCells()
	if len(cells) == 0 {
		return nil
	}
	lines := []string{sectionLine(fmt.Sprintf("DRILLABLE FAILURES (%d)", len(cells)), width)}
	for i, cell := range cells {
		bar := " "
		if s.focus == expFocusDetail && i == s.cellIdx {
			bar = experimentsStyles.ToneStyle(theme.ToneTeal).Render("▌")
		}
		trace := ""
		if len(cell.TraceIDs) > 0 {
			trace = shortID(cell.TraceIDs[0], 8)
		}
		line := fmt.Sprintf("%s%s %s  %s  %s", bar, kit.StatusDot(cell.Status), cell.CaseID, cell.VariantName, trace)
		lines = append(lines, padRow(line, width))
	}
	return lines
}

func aggregatePass(agg api.QualityVariantAggregate) float64 { return agg.PassRate }

func primaryScore(agg api.QualityVariantAggregate) float64 {
	if stats, ok := agg.Scores["overall"]; ok {
		return stats.Mean
	}
	for _, stats := range agg.Scores {
		return stats.Mean
	}
	return 0
}

func avgTokens(agg api.QualityVariantAggregate) int {
	if agg.Cells <= 0 {
		return 0
	}
	return int(agg.Latency.P95Ms)
}

func formatCost(cost *float64) string {
	if cost == nil {
		return "-"
	}
	return fmt.Sprintf("$%.2f", *cost)
}

func deltaPass(pass, base float64) string {
	if base == 0 {
		return "-"
	}
	return fmt.Sprintf("%+.0f", (pass-base)*100)
}

func containsString(items []string, needle string) bool {
	for _, item := range items {
		if item == needle {
			return true
		}
	}
	return false
}

func passTone(pass float64) theme.Tone {
	if pass >= 0.95 {
		return theme.ToneGreen
	}
	if pass < 0.90 {
		return theme.ToneRed
	}
	return theme.ToneAmber
}

func truncateCell(s string, w int) string {
	return strings.TrimSpace(shell.Text.Render(truncate(s, w)))
}
