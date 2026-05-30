package overlays

import (
	"strings"
	"testing"
)

// TestHelpOverlayHasNoTabSwitchRows asserts the help overlay no longer
// advertises Ctrl+1..4 tab switching. The four-section tab strip was
// dropped in S2; advertising tab-switch chords would lie about what the
// workbench actually does.
func TestHelpOverlayHasNoTabSwitchRows(t *testing.T) {
	h := NewHelp()
	h.Open()
	out := h.View(120, 40)
	for _, label := range []string{"quality tab", "traces tab", "eval tab", "shell tab"} {
		if strings.Contains(out, label) {
			t.Errorf("help overlay still advertises %q — should be removed with the tab strip", label)
		}
	}
}
