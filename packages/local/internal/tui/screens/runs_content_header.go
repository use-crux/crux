package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (s *Runs) runHeaderStrip(width int) string {
	if s.diagnosis == nil || width <= 0 {
		return ""
	}
	content := projectRunHeader(s.diagnosis.Raw)
	parts := make([]string, 0, 6)
	if content.Composition != "" {
		parts = append(parts, sanitizeRunsInline(content.Composition))
	}
	if content.Models != "" {
		parts = append(parts, "model "+sanitizeRunsInline(content.Models))
	}
	if content.Delivery != "" {
		parts = append(parts, runsStyles.Amber.Render("delivery "+sanitizeRunsInline(content.Delivery)))
	}
	if content.Redacted > 0 {
		parts = append(parts, runsStyles.Violet.Render(fmt.Sprintf("redacted %d", content.Redacted)))
	}
	if position, total := s.failurePosition(); total > 0 {
		parts = append(parts, runsStyles.Red.Render(fmt.Sprintf("‹ ⚠ %d/%d › e/E", position, total)))
	}
	if len(parts) == 0 {
		return ""
	}
	return kit.Fit(" "+strings.Join(parts, shell.TextMuted.Render(" · ")), width, "…")
}

func (s *Runs) failurePosition() (int, int) {
	failures := s.failingSpanIDs()
	if len(failures) == 0 {
		return 0, 0
	}
	selected := s.SelectedSpanID()
	for index, id := range failures {
		if id == selected {
			return index + 1, len(failures)
		}
	}
	return 1, len(failures)
}
