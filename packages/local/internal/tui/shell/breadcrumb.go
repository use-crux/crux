package shell

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// Breadcrumb renders the thin row above each screen body:
//
//	quality / insights / INS-014               · 8 of 8 shown ·
//
// `path` is the dotted hierarchy (last item highlighted), `right` is the
// optional context note printed flush-right.
func Breadcrumb(width int, path []string, right string) string {
	if width <= 0 {
		return ""
	}
	dim := lipgloss.NewStyle().Foreground(ColorTextDim)
	muted := lipgloss.NewStyle().Foreground(ColorTextMuted)
	emphasized := lipgloss.NewStyle().Foreground(ColorText)

	parts := make([]string, 0, len(path)*2)
	for i, p := range path {
		if i > 0 {
			parts = append(parts, muted.Render(" / "))
		}
		if i == len(path)-1 {
			parts = append(parts, emphasized.Render(p))
		} else {
			parts = append(parts, dim.Render(p))
		}
	}
	left := " " + strings.Join(parts, "")
	rightR := ""
	if right != "" {
		rightR = muted.Render(right) + " "
	}

	leftW := lipgloss.Width(left)
	rightW := lipgloss.Width(rightR)
	pad := width - leftW - rightW
	if pad < 1 {
		pad = 1
	}

	row := left + strings.Repeat(" ", pad) + rightR
	// No bg fill — breadcrumb sits on the same bg as the screen body
	// below it, separated only by the divider line. Matches the design's
	// uniform dark theme without an extra panel band at the top.
	body := lipgloss.NewStyle().Width(width).Render(row)
	return body + "\n" + horizontalBorder(width)
}
