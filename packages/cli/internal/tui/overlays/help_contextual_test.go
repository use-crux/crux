package overlays

import (
	"strings"
	"testing"

	"github.com/anthropics/crux-cli/internal/tui/shell"
)

// TestHelpOverlayRendersContextualActGroup asserts that when the help
// overlay is fed the active screen's keybinds, those binds appear in the
// rendered output under a screen-specific Act section. The static global
// Act group is gone — every screen names its own actions per
// KEYBINDS.md. Labels match the short form used by every screen's
// Keybinds() in practice (one or two words, fits in a help column).
func TestHelpOverlayRendersContextualActGroup(t *testing.T) {
	h := NewHelp()
	h.SetScreenKeybinds("insights", []shell.Keybind{
		{Key: "s", Label: "save cases"},
		{Key: "p", Label: "promote fix"},
		{Key: "x", Label: "dismiss"},
	})
	h.Open()
	out := h.View(120, 40)

	if !strings.Contains(out, "save cases") {
		t.Errorf("help overlay missing screen-specific bind label \"save cases\"")
	}
	if !strings.Contains(out, "promote fix") {
		t.Errorf("help overlay missing screen-specific bind label \"promote fix\"")
	}
	// The screen id should be visible so users know which screen's keymap
	// they are reading.
	if !strings.Contains(out, "insights") {
		t.Errorf("help overlay does not name the focused screen (\"insights\") in the Act section")
	}
	// And the old composite lie must be gone.
	if strings.Contains(out, "save (case · variant · baseline · cassette)") {
		t.Errorf("help overlay still renders the static composite Act group — should be screen-contextual now")
	}
}

// TestHelpOverlayLayer1ChordsAlwaysVisible asserts the truly-global Layer-1
// chords stay rendered even when no screen-specific binds are set.
func TestHelpOverlayLayer1ChordsAlwaysVisible(t *testing.T) {
	h := NewHelp()
	h.Open()
	out := h.View(120, 40)
	for _, label := range []string{"command palette", "this help"} {
		if !strings.Contains(out, label) {
			t.Errorf("help overlay missing Layer-1 chord label %q", label)
		}
	}
}
