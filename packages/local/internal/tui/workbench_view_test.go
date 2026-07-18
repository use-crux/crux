package tui

import (
	"strings"
	"testing"
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
