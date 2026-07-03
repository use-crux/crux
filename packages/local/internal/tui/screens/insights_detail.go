package screens

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (s *Insights) renderDetail(width, height int) string {
	ins := s.currentInsight()
	if ins == nil {
		return centerMsg(Size{Width: width, Height: height}, "select an insight")
	}

	body := make([]string, 0, height)
	body = append(body, s.renderBadgeLine(*ins, width))
	body = append(body, padRow(" "+shell.Text.Render(kit.Truncate(ins.Title, max(0, width-2), "...")), width))
	body = append(body, wrapLines(ins.Summary, width, shell.TextDim)...)
	body = append(body, horizontalRuleDim(width))
	body = append(body, s.renderTabs(width))
	body = append(body, horizontalRuleDim(width))
	body = append(body, s.renderTabBody(*ins, width, max(1, height-len(body)))...)

	if len(body) > height {
		body = body[:height]
	}
	for len(body) < height {
		body = append(body, strings.Repeat(" ", width))
	}
	return strings.Join(body, "\n")
}

func (s *Insights) renderBadgeLine(ins api.QualityInsightRecord, width int) string {
	parts := []string{kit.Badge(ins.Severity, severityTone(ins.Severity), insightsStyles)}
	for _, tag := range ins.Tags {
		parts = append(parts, kit.Badge(tag, theme.ToneDim, insightsStyles))
		if len(parts) == 4 {
			break
		}
	}
	meta := shell.TextMuted.Render(fmt.Sprintf("%s · updated %s · %d occurrences", ins.InsightID, relTime(ins.UpdatedAt), ins.OccurrenceCount))
	left := strings.Join(parts, " ")
	pad := width - lipgloss.Width(left) - lipgloss.Width(meta) - 2
	if pad < 1 {
		return padRow(" "+left, width)
	}
	return padRow(" "+left+strings.Repeat(" ", pad)+meta, width)
}

func (s *Insights) renderTabs(width int) string {
	tabs := []struct {
		id    string
		label string
	}{
		{"diagnosis", "Diagnosis"},
		{"traces", "Traces"},
		{"cases", "Cases"},
		{"compare", "Compare"},
		{"fix", "Fix"},
	}
	parts := make([]string, 0, len(tabs))
	for _, tab := range tabs {
		style := insightsStyles.Dim
		if tab.id == s.tab {
			style = insightsStyles.AccentHeader
		}
		parts = append(parts, style.Render(tab.label))
	}
	return padRow(" "+strings.Join(parts, insightsStyles.Border.Render(" · ")), width)
}

func (s *Insights) renderTabBody(ins api.QualityInsightRecord, width, height int) []string {
	switch s.tab {
	case "traces":
		return s.renderLinkedIDs("LINKED TRACES", ins.LinkedTraceIDs, width, height)
	case "cases":
		return s.renderLinkedIDs("LINKED CASES", ins.LinkedCaseIDs, width, height)
	case "compare":
		return s.renderLinkedIDs("LINKED EXPERIMENTS", ins.LinkedExperimentIDs, width, height)
	case "fix":
		return s.renderFixTab(ins, width, height)
	default:
		return s.renderDiagnosisTab(ins, width, height)
	}
}

func (s *Insights) renderDiagnosisTab(ins api.QualityInsightRecord, width, height int) []string {
	lines := []string{padRow(" "+insightsStyles.Accent.Render("PATTERN"), width)}
	pattern := ins.SuspectedCause
	if pattern == "" {
		pattern = "No pattern details are available yet."
	}
	boxH := min(6, max(3, height/2))
	lines = append(lines, kit.Box("", wrapPlain(pattern, max(1, width-4)), kit.Rect{W: width, H: boxH}, true, insightsStyles)...)
	if ins.DetailStats != nil && len(lines) < height {
		lines = append(lines, s.renderStatCells(*ins.DetailStats, width)...)
	}
	return clampLines(lines, width, height)
}

func (s *Insights) renderStatCells(stats api.QualityInsightDetailStats, width int) []string {
	cellW := max(12, (width-2)/3)
	cells := []string{
		statCell("tokens/run", fmt.Sprintf("%.1fk", stats.TokensPerRun/1000), stats.TokensDeltaVsBaseline, stats.TokensSpark, cellW),
		statCell("latency p95", latencyLabel(stats.LatencyP95Ms), stats.LatencyDeltaVsBaseline, stats.LatencySpark, cellW),
		statCell("cost/100", fmt.Sprintf("$%.2f", stats.CostPer100), stats.CostDeltaVsBaseline, stats.CostSpark, cellW),
	}
	return strings.Split(kit.ComposeColumns(cells...), "\n")
}

func statCell(label, value, delta string, spark []float64, width int) string {
	lines := []string{
		" " + shell.TextMuted.Render(label),
		" " + shell.Text.Render(value) + " " + shell.Amber.Render(delta),
		" " + kit.Sparkline(spark, max(1, width-2), shell.ColorAmber),
	}
	return strings.Join(lines, "\n")
}

func (s *Insights) renderLinkedIDs(title string, ids []string, width, height int) []string {
	lines := []string{padRow(" "+insightsStyles.Accent.Render(fmt.Sprintf("%s · %d", title, len(ids))), width)}
	if len(ids) == 0 {
		lines = append(lines, padRow(" "+shell.TextMuted.Render("none linked yet"), width))
		return clampLines(lines, width, height)
	}
	for _, id := range ids {
		lines = append(lines, padRow(" · "+shell.Text.Render(id), width))
	}
	return clampLines(lines, width, height)
}

func (s *Insights) renderFixTab(ins api.QualityInsightRecord, width, height int) []string {
	lines := []string{padRow(" "+insightsStyles.Accent.Render("PROPOSED FIX"), width)}
	fix := ins.ProposedFix
	if ins.ProposedFixConfig != nil && ins.ProposedFixConfig.YAML != "" {
		fix = ins.ProposedFixConfig.YAML
	}
	if fix == "" {
		lines = append(lines, padRow(" "+shell.TextMuted.Render("no fix proposed"), width))
		return clampLines(lines, width, height)
	}
	boxH := min(height-1, max(3, len(strings.Split(fix, "\n"))+2))
	lines = append(lines, kit.Box("", strings.Split(fix, "\n"), kit.Rect{W: width, H: boxH}, true, insightsStyles)...)
	if ins.ProposedFixConfig != nil && len(ins.ProposedFixConfig.ConfigKeys) > 0 {
		lines = append(lines, padRow(" "+shell.TextDim.Render("config keys: ")+shell.Text.Render(strings.Join(ins.ProposedFixConfig.ConfigKeys, ", ")), width))
	}
	return clampLines(lines, width, height)
}
