package screens

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// --- left pane: run list ----------------------------------------------------

func (s *Runs) renderList(width, height int) string {
	right := shell.TextMuted.Render("sort: time ↓")
	listSnapshot := s.runsResource.Snapshot()
	if filter := s.activeRunStatusFilter(); filter.label != "" {
		right = shell.TextMuted.Render("filter: " + filter.label)
	}
	if s.runQuery != "" {
		right = shell.TextMuted.Render("/" + sanitizeRunsInline(s.runQuery))
	}
	if export := s.currentRunExportState(); export != "" {
		right = shell.TextMuted.Render(export)
	}
	header := shell.PaneHeader(width,
		focusTitle("Runs", s.focus == focusRuns),
		"last 1h", right)
	hdrH := strings.Count(header, "\n") + 1
	status := resourceLifecycleStatus(listSnapshot.State, listSnapshot.Refreshing, listSnapshot.Err)
	if status != "" {
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

	runs := s.filteredRuns()
	if len(runs) == 0 {
		b.WriteString(padRow(" "+shell.TextMuted.Render("No runs yet — use your app with `crux dev` running, or run `crux eval`."), width))
		b.WriteString("\n")
		for i := 1; i < bodyRows; i++ {
			b.WriteString(strings.Repeat(" ", width) + "\n")
		}
		return strings.TrimRight(b.String(), "\n")
	}

	rows := s.runList.Render(func(r api.ObservabilityRunSummary, _ int, selected bool, rowW int) string {
		row1, row2 := s.renderRunRow(r, rowW, selected)
		return row1 + "\n" + row2
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
	nameBudget := max(1, width-lipgloss.Width(leading)-lipgloss.Width(ago)-2)
	name := kit.TruncateMiddle(sanitizeRunsInline(firstNonEmpty(r.Name, r.RunID)), nameBudget, "…")
	line1 := kit.FitMiddle(width, leading, shell.Text.Render(name), ago+" ", "…")

	// Line 2: indented duration and token count.
	lat := durStr(durationPointer(r.DurationMs))
	tokenCount := intMetric(observabilityMetrics(r.Metrics), "totalTokens")
	tok := formatTokensShort(tokenCount) + " tok"
	if tokenCount == 0 {
		tok = "— tok"
	}
	subParts := []string{lat, tok}
	line2 := "    " + shell.TextMuted.Render(strings.Join(subParts, " · "))

	return padRow(line1, width), padRow(line2, width)
}
