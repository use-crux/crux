package tui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

// TestWorkbenchViewHasNoTabStrip asserts the top tab strip is gone from
// the rendered TUI. The four-section tab strip (`quality · traces · eval
// · shell`) was superseded by the unified breadcrumb-with-status row
// (see plans/tui-v1-quality-workbench-implementation.md S2).
func TestWorkbenchViewHasNoTabStrip(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(120, 30)
	out := w.View()

	// The legacy strip rendered `◆ quality│◐ traces│◧ eval│›_ shell`.
	// Any of the three non-`quality` tab labels appearing on the top row
	// indicates the strip is still present.
	for _, marker := range []string{"◐ traces", "◧ eval", "›_ shell"} {
		if strings.Contains(out, marker) {
			t.Errorf("Workbench.View() still contains tab-strip marker %q", marker)
		}
	}
}

func TestOverlayCentersHorizontallyAndOneThirdVertically(t *testing.T) {
	const width, height = 160, 45
	overlay := strings.Join([]string{
		"╭" + strings.Repeat("─", 38) + "╮",
		"│" + strings.Repeat(" ", 38) + "│",
		"╰" + strings.Repeat("─", 38) + "╯",
	}, "\n")
	frame := ansi.Strip(overlayOnto(kit.PadBlock("", width, height), overlay, width, height))
	lines := strings.Split(frame, "\n")
	wantTop := (height - 3) / 3
	wantLeft := (width - 40) / 2
	gotTop, gotLeft := -1, -1
	for index, line := range lines {
		if left := strings.Index(line, "╭"); left >= 0 {
			gotTop, gotLeft = index, left
			break
		}
	}
	if gotTop != wantTop || gotLeft != wantLeft {
		t.Fatalf("overlay origin = (%d,%d), want (%d,%d)", gotLeft, gotTop, wantLeft, wantTop)
	}
}
