package screens

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (s *Insights) renderList(width, height int) string {
	high, med, low := s.severityCounts()
	right := shell.Rose.Render(fmt.Sprintf("%d high", high)) + " " +
		shell.Amber.Render(fmt.Sprintf("%d med", med)) + " " +
		shell.TextDim.Render(fmt.Sprintf("%d low", low))
	if width < 44 {
		right = shell.Rose.Render(fmt.Sprintf("%dH", high)) + " " +
			shell.Amber.Render(fmt.Sprintf("%dM", med)) + " " +
			shell.TextDim.Render(fmt.Sprintf("%dL", low))
	}
	header := shell.PaneHeader(width, focusTitle("Insights", s.focus == focusInsightsList), fmt.Sprintf("%d open", s.openCount()), right)
	headerRows := strings.Count(header, "\n") + 1
	bodyRows := max(1, height-headerRows)

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	s.list.SetItems(s.items)
	s.list.SetHeight(bodyRows)
	s.list.SetCursorByIdentity(s.selectedID)
	rows := s.list.Render(width, func(ins api.InspectInsightRecord, _ int, selected bool, rowW int) string {
		row1, row2 := s.renderListRow(ins, rowW, selected)
		return row1 + "\n" + row2
	})
	for _, row := range rows {
		b.WriteString(row)
		b.WriteString("\n")
	}
	for len(rows) < bodyRows {
		b.WriteString(strings.Repeat(" ", width))
		b.WriteString("\n")
		rows = append(rows, "")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Insights) renderListRow(ins api.InspectInsightRecord, width int, selected bool) (string, string) {
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	dot := kit.SeverityDot(ins.Severity)
	id := shell.TextMuted.Render(shortID(ins.InsightID, 8))
	title := shell.Text.Render(kit.Truncate(ins.Title, max(0, width-24), "..."))
	age := shell.TextMuted.Render(relTime(ins.UpdatedAt))
	line1 := fmt.Sprintf("%s%s %s  %s", bar, dot, id, title)
	pad := width - lipgloss.Width(line1) - lipgloss.Width(age) - 1
	if pad < 1 {
		pad = 1
	}
	line1 += strings.Repeat(" ", pad) + age

	meta := []string{}
	if tag := firstString(ins.Tags); tag != "" {
		meta = append(meta, tag)
	}
	if ins.TargetID != "" {
		meta = append(meta, ins.TargetID)
	}
	meta = append(meta, fmt.Sprintf("%d traces", len(ins.LinkedTraceIDs)))
	line2 := "   " + shell.TextDim.Render(strings.Join(meta, " · "))
	if len(ins.Trend) > 0 && width >= 48 {
		line2 += "  " + kit.Sparkline(ins.Trend, min(10, width/5), shell.SeverityColor(ins.Severity))
	}
	return padRow(line1, width), padRow(line2, width)
}

func (s *Insights) severityCounts() (high, medium, low int) {
	for _, ins := range s.items {
		switch ins.Severity {
		case "high":
			high++
		case "medium":
			medium++
		default:
			low++
		}
	}
	return high, medium, low
}
