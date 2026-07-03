package tui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

// TestWorkbenchHelpRendersActiveScreenKeybinds asserts that when the user
// presses `?` to open the help overlay, the rendered overlay contains the
// active screen's keybind labels — proving the workbench wires the
// focused screen's Keybinds() into the help overlay's contextual Act
// section before rendering.
func TestWorkbenchHelpRendersActiveScreenKeybinds(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(160, 40)
	// Default active nav is "overview". Overview's Keybinds() includes
	// short, well-known labels like "insights", "runs", "suites" via the
	// g-prefix chords. We assert at least one of those labels appears in
	// the rendered help overlay output.
	w.Update(tea.KeyPressMsg(tea.Key{Text: "?", Code: '?'}))
	out := w.View()

	if !strings.Contains(out, "? help") {
		t.Fatalf("workbench did not render the help overlay after `?`:\n%s", out)
	}
	// Overview's Keybinds() contains `{Key: "g s", Label: "suites"}`.
	if !strings.Contains(out, "suites") {
		t.Errorf("help overlay does not contain Overview screen-specific label \"suites\" — workbench is not feeding the screen's Keybinds()")
	}
	// The Act section title should include the active screen id. The
	// SectionTag style renders titles uppercase, so we match
	// case-insensitively.
	if !strings.Contains(strings.ToLower(out), strings.ToLower("Act · overview")) {
		t.Errorf("help overlay Act section is not named after the active screen (expected \"Act · overview\", case-insensitive)\nfull output:\n%s", out)
	}
}
