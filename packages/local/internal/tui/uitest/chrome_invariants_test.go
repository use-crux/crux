package uitest

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func TestPaneTitleNeverWrapsAtSupportedWidths(t *testing.T) {
	for width := 60; width <= 200; width++ {
		view := shell.PaneHeader(width, "▸ Runs", "last 1h", "sort: time ↓")
		lines := strings.Split(view, "\n")
		if len(lines) != 3 {
			t.Fatalf("width %d rendered %d pane-header rows, want 3:\n%s", width, len(lines), view)
		}
		for index, line := range lines {
			if got := lipgloss.Width(line); got != width {
				t.Fatalf("width %d row %d rendered %d cells", width, index+1, got)
			}
		}
	}
}
