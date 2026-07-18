package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (s *Runs) waterfallHeader(width int) string {
	if s.detail == nil {
		return shell.PaneHeader(width, focusTitle("Trace", s.focus == focusWaterfall), "—", "")
	}
	// The canonical noun is Run. Multi-trace runs surface their trace count
	// in the subtitle rather than changing the title.
	id := shortID(s.detail.Run.TraceID, 7)
	title := focusTitle("Run "+id, s.focus == focusWaterfall)
	tokStr := ""
	if s.detail.Run.TokenCount > 0 {
		tokStr = " · " + formatTokensShort(s.detail.Run.TokenCount) + " tok"
	}
	subParts := []string{
		s.detail.Run.TargetID,
		durStr(s.detail.Run.DurationMs),
		fmt.Sprintf("%d spans", len(s.detail.Spans)),
	}
	if s.detail.Run.TraceCount > 1 {
		subParts = append(subParts, fmt.Sprintf("%d traces", s.detail.Run.TraceCount))
	}
	headerChips := renderTraceChips(s.detail)
	if width < 88 {
		headerChips = ""
	}
	return shell.PaneHeader(width, title, strings.Join(subParts, " · ")+tokStr, headerChips)
}

func (s *Runs) waterfallFooter(width int) string {
	return shell.PaneFooter(width, s.waterfallKeybinds())
}

func (s *Runs) waterfallSpanHeight(width, height int) int {
	if s.detail == nil {
		return 0
	}
	headerHeight := strings.Count(s.waterfallHeader(width), "\n") + 1
	footerHeight := 0
	if footer := s.waterfallFooter(width); footer != "" {
		footerHeight = strings.Count(footer, "\n") + 1
	}
	return max(0, height-headerHeight-footerHeight-1) // reserve the ruler row
}
