package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (s *Runs) waterfallHeader(width int) string {
	if s.diagnosis == nil {
		return shell.PaneHeader(width, focusTitle("Trace", s.focus == focusWaterfall), "—", "")
	}
	summary := s.diagnosis.Summary
	title := focusTitle("Run "+clipRunsInline(summary.RunID, 7), s.focus == focusWaterfall)
	count := len(s.diagnosis.Timeline)
	subParts := []string{sanitizeRunsInline(summary.Name), formatSpanDuration(summary.DurationMs), fmt.Sprintf("%d %s", count, kit.Pluralize(count, "span"))}
	return shell.PaneHeader(width, title, strings.Join(subParts, " · "), "")
}

func (s *Runs) waterfallHeaderBlock(width int) string {
	header := s.waterfallHeader(width)
	snapshot := s.detailResource.Snapshot()
	status := resourceLifecycleStatus(snapshot.State, snapshot.Refreshing, snapshot.Err)
	if status == "" {
		return header
	}
	return header + "\n" + lifecycleStatusRow(status, width)
}

func (s *Runs) waterfallFooter(width int) string {
	return shell.PaneFooter(width, s.waterfallKeybinds())
}

func (s *Runs) waterfallSpanHeight(width, height int) int {
	if s.diagnosis == nil {
		return 0
	}
	headerHeight := strings.Count(s.waterfallHeaderBlock(width), "\n") + 1
	footerHeight := 0
	if footer := s.waterfallFooter(width); footer != "" {
		footerHeight = strings.Count(footer, "\n") + 1
	}
	return max(0, height-headerHeight-footerHeight-1) // reserve the ruler row
}
