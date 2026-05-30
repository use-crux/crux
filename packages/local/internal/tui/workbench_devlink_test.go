package tui

import (
	"strings"
	"testing"
)

// TestWorkbenchBreadcrumbDevtoolsLinkIsHyperlink asserts the server-URL
// chip in the breadcrumb right-meta is wrapped in an OSC 8 hyperlink
// escape so modern terminals render it as a clickable link to the
// devtools web UI. The previous design lost the clickability when S2
// stripped the URL scheme for display — the OSC 8 wrapper restores it
// while keeping the chip compact.
func TestWorkbenchBreadcrumbDevtoolsLinkIsHyperlink(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4317")
	w.Resize(160, 30)

	out := w.View()

	// OSC 8 hyperlink open sequence is ESC]8;;URL\x07 (BEL terminator)
	// or ESC]8;;URL\x1b\\ (ST terminator). We use BEL.
	const oscOpen = "\x1b]8;;http://localhost:4317\x07"
	const oscClose = "\x1b]8;;\x07"
	if !strings.Contains(out, oscOpen) {
		t.Errorf("View() does not contain OSC 8 open sequence for the devtools URL\nexpected to find %q in output", oscOpen)
	}
	if !strings.Contains(out, oscClose) {
		t.Errorf("View() does not contain OSC 8 close sequence")
	}
}
