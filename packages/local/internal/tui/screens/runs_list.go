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
	if filter := s.activeRunStatusFilter(); filter.label != "" {
		right = shell.TextMuted.Render("filter: " + filter.label)
	}
	if s.runQuery != "" {
		right = shell.TextMuted.Render("/" + s.runQuery)
	}
	header := shell.PaneHeader(width,
		focusTitle("Runs", s.focus == focusRuns),
		"Last 1h", right)
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	if bodyRows < 1 {
		bodyRows = 1
	}

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")

	runs := s.filteredRuns()
	if len(runs) == 0 {
		b.WriteString(" " + shell.TextMuted.Render("no runs yet"))
		b.WriteString("\n")
		for i := 1; i < bodyRows; i++ {
			b.WriteString(strings.Repeat(" ", width) + "\n")
		}
		return strings.TrimRight(b.String(), "\n")
	}

	s.runList.SetItems(runs)
	s.runList.SetHeight(bodyRows)
	s.runList.SetCursorByIdentity(s.selRun)
	rows := s.runList.Render(width, func(r api.ObservabilityRunSummary, _ int, selected bool, rowW int) string {
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

	idCol := shell.Text.Render(padString2(shortID(r.RunID, 7), 7))
	ago := shell.TextMuted.Render(relTimeUnix(parseObservabilityTime(r.StartedAt)))

	// Line 1: bar + dot + id + target + age (right).
	line1Core := fmt.Sprintf("%s %s %s", bar, dot, idCol)
	if width >= 32 {
		targetCol := shell.TextDim.Render(truncate(firstNonEmpty(r.Name, r.RootPrimitive, r.RunID), 12))
		line1Core += "  " + targetCol
	}
	pad := width - lipgloss.Width(line1Core) - lipgloss.Width(ago) - 2
	if pad < 1 {
		pad = 1
	}
	line1 := line1Core + strings.Repeat(" ", pad) + ago + " "

	// Line 2: indented duration and token count.
	lat := durStr(durationPointer(r.DurationMs))
	tokenCount := intMetric(observabilityMetrics(r.Metrics), "totalTokens")
	tok := formatTokensShort(tokenCount) + " tok"
	if tokenCount == 0 {
		tok = "— tok"
	}
	subParts := []string{lat, tok}
	line2 := "    " + shell.TextMuted.Render(strings.Join(subParts, "  "))

	return padRow(line1, width), padRow(line2, width)
}
