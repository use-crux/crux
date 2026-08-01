package screens

import (
	"encoding/json"
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// --- left pane: run list ----------------------------------------------------

func (s *Runs) renderList(width, height int) string {
	meta := make([]string, 0, 7)
	listSnapshot := s.runsResource.Snapshot()
	if group := s.activeRunGroup(); group.label != "none" {
		meta = append(meta, "group: "+group.label)
	}
	if filter := s.activeRunStatusFilter(); filter.label != "all" {
		meta = append(meta, "filter: "+filter.label)
	}
	if s.sessionFilter != "" {
		meta = append(meta, "session: "+kit.TruncateMiddle(sanitizeRunsInline(s.sessionFilter), 18, "…"))
	}
	if s.definitionFilter != "" {
		meta = append(meta, "definition: "+kit.TruncateMiddle(sanitizeRunsInline(s.definitionFilter), 24, "…"))
	}
	if s.runQuery != "" {
		meta = append(meta, "/"+sanitizeRunsInline(s.runQuery))
	}
	if export := s.currentRunExportState(); export != "" {
		meta = append(meta, export)
	}
	if len(meta) == 0 {
		meta = append(meta, "sort: time ↓")
	}
	right := shell.TextMuted.Render(strings.Join(meta, " · "))
	modelScope := ""
	if s.modelFilter != "" {
		// The canonical observability list cannot apply model metadata before
		// its bounded page yet. Keep the scope on a dedicated row so combined
		// filter metadata cannot crowd it out or be replaced by it.
		modelBudget := max(1, width-lipgloss.Width(" model:  · newest 100"))
		model := kit.TruncateMiddle(shortRunModel(s.modelFilter), modelBudget, "…")
		modelScope = "model: " + model + " · newest 100"
	}
	window := "all time"
	if s.activeRunWindow().label != "all" {
		window = "last " + s.activeRunWindow().label
	}
	header := shell.PaneHeader(width,
		focusTitle("Runs", s.focus == focusRuns),
		window, right)
	hdrH := strings.Count(header, "\n") + 1
	status := resourceLifecycleStatus(listSnapshot.State, listSnapshot.Refreshing, listSnapshot.Err)
	if status != "" {
		hdrH++
	}
	if modelScope != "" {
		hdrH++
	}
	bodyRows := height - hdrH
	if bodyRows < 1 {
		bodyRows = 1
	}

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	if status != "" {
		b.WriteString(padRow(" "+shell.TextMuted.Render(truncateRunsInline(status, max(0, width-2))), width))
		b.WriteString("\n")
	}
	if modelScope != "" {
		b.WriteString(padRow(" "+shell.TextMuted.Render(modelScope), width))
		b.WriteString("\n")
	}

	runs := s.filteredRuns()
	if len(runs) == 0 {
		empty := "No runs yet — use your app with `crux dev` running, or run `crux eval`."
		if s.hasActiveRunFilters() {
			empty = "No runs match the current filters."
		}
		b.WriteString(padRow(" "+shell.TextMuted.Render(empty), width))
		b.WriteString("\n")
		for i := 1; i < bodyRows; i++ {
			b.WriteString(strings.Repeat(" ", width) + "\n")
		}
		return strings.TrimRight(b.String(), "\n")
	}

	rows := s.runList.Render(func(r api.ObservabilityRunSummary, _ int, selected bool, rowW int) string {
		row1, row2 := s.renderRunRow(r, rowW, selected)
		if !s.isRunGroupStart(r) {
			return row1 + "\n" + row2
		}
		return s.renderRunGroupHeader(r, rowW) + "\n" + row1 + "\n" + row2
	})
	for _, row := range rows {
		b.WriteString(row)
		b.WriteString("\n")
	}
	for len(rows) < bodyRows {
		b.WriteString(strings.Repeat(" ", width) + "\n")
		rows = append(rows, "")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Runs) renderRunRow(r api.ObservabilityRunSummary, width int, selected bool) (string, string) {
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	dot := kit.StatusDot(normalizeObservabilityStatus(r.Status))
	ago := shell.TextMuted.Render(relTimeUnix(parseObservabilityTime(r.StartedAt)))
	leading := fmt.Sprintf("%s %s ", bar, dot)
	right := ago + " "
	if s.layout.mode == runsLayoutWide && r.Model != "" {
		right = shell.TextDim.Render(shortRunModel(r.Model)) + "  " + right
	}
	nameBudget := max(1, width-lipgloss.Width(leading)-lipgloss.Width(right)-1)
	name := kit.TruncateMiddle(sanitizeRunsInline(firstNonEmpty(r.Name, r.RunID)), nameBudget, "…")
	line1 := kit.FitMiddle(width, leading, shell.Text.Render(name), right, "…")

	lat := durStr(durationPointer(r.DurationMs))
	metrics := observabilityMetrics(r.Metrics)
	tokenCount := intMetric(metrics, "totalTokens")
	tok := formatTokensShort(tokenCount) + " tok"
	if tokenCount == 0 {
		tok = "— tok"
	}
	subParts := []string{lat, tok}
	if s.layout.mode == runsLayoutWide {
		if cost, ok := runMetric(metrics, "costUsd", "cost"); ok {
			subParts = append(subParts, formatRunCost(cost))
		}
		if health := runHealthGlyphs(r); health != "" {
			subParts = append(subParts, health)
		}
	}
	line2 := "    " + shell.TextMuted.Render(strings.Join(subParts, " · "))

	return padRow(line1, width), padRow(line2, width)
}

func (s *Runs) renderRunGroupHeader(run api.ObservabilityRunSummary, width int) string {
	group := s.runGroupRows(run)
	identity := []string{
		strings.ToUpper(s.activeRunGroup().label) + " " + sanitizeRunsInline(s.runGroupKey(run)),
		fmt.Sprintf("%d %s", len(group), kit.Pluralize(len(group), "run")),
	}
	metricsSummary := make([]string, 0, 3)
	failures := 0
	var totalTokens int
	var totalCost, totalDuration float64
	var tokenCount, costCount, durationCount int
	for _, item := range group {
		if runStatusMatches(item.Status, runStatusFilters[2].statuses) {
			failures++
		}
		metrics := observabilityMetrics(item.Metrics)
		if tokens, ok := runMetric(metrics, "totalTokens"); ok {
			totalTokens += int(tokens)
			tokenCount++
		}
		if cost, ok := runMetric(metrics, "costUsd", "cost"); ok {
			totalCost += cost
			costCount++
		}
		if item.DurationMs > 0 {
			totalDuration += item.DurationMs
			durationCount++
		}
	}
	if failures > 0 {
		identity = append(identity, fmt.Sprintf("%d fail", failures))
	}
	if tokenCount > 0 {
		metricsSummary = append(metricsSummary, "Σ"+formatTokensShort(totalTokens)+" tok")
	}
	if costCount > 0 {
		metricsSummary = append(metricsSummary, "Σ"+formatRunCost(totalCost))
	}
	if durationCount > 0 {
		average := totalDuration / float64(durationCount)
		metricsSummary = append(metricsSummary, "avg "+durStr(&average))
	}
	line1 := " " + strings.Join(identity, " · ")
	line2 := "   " + strings.Join(metricsSummary, " · ")
	return padRow(shell.TextDim.Render(kit.TruncateMiddle(line1, width, "…")), width) + "\n" +
		padRow(shell.TextDim.Render(kit.TruncateMiddle(line2, width, "…")), width)
}

func (s *Runs) runGroupRows(run api.ObservabilityRunSummary) []api.ObservabilityRunSummary {
	key := s.runGroupKey(run)
	s.filteredRuns()
	return s.projection.groups[key]
}

func (s *Runs) hasActiveRunFilters() bool {
	return s.runQuery != "" ||
		s.activeRunStatusFilter().label != "all" ||
		s.activeRunWindow().label != "all" ||
		s.modelFilter != "" ||
		s.sessionFilter != "" ||
		s.definitionFilter != ""
}

func runMetric(metrics map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		switch value := metrics[key].(type) {
		case float64:
			return value, true
		case int:
			return float64(value), true
		case json.Number:
			number, err := value.Float64()
			return number, err == nil
		}
	}
	return 0, false
}

func formatRunCost(cost float64) string {
	if cost < 0.01 {
		return fmt.Sprintf("$%.4f", cost)
	}
	if cost < 1 {
		return fmt.Sprintf("$%.3f", cost)
	}
	return fmt.Sprintf("$%.2f", cost)
}

func shortRunModel(model string) string {
	model = sanitizeRunsInline(model)
	if slash := strings.LastIndex(model, "/"); slash >= 0 {
		model = model[slash+1:]
	}
	return kit.TruncateMiddle(model, 14, "…")
}

func runHealthGlyphs(run api.ObservabilityRunSummary) string {
	parts := make([]string, 0, 3)
	if run.DeliveryHealth != nil && run.DeliveryHealth.Status == "degraded" {
		parts = append(parts, runsStyles.Amber.Render("⇣"))
	}
	if run.SuspendedChildCount > 0 {
		parts = append(parts, fmt.Sprintf("⏸%d", run.SuspendedChildCount))
	}
	if run.FailedChildCount > 0 {
		parts = append(parts, runsStyles.Red.Render(fmt.Sprintf("!%d", run.FailedChildCount)))
	}
	return strings.Join(parts, " ")
}

func selectedSessionActionLabel(active string) string {
	if active != "" {
		return "session: clear"
	}
	return "filter session"
}
