package shell

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

// TestStatusBarHasNoModeChip asserts the status bar no longer renders a
// mode-name chip (NORMAL/INSERT/COMMAND). The approved 2026-07-16 TUI
// stabilization design makes the status bar pure executable-key context.
func TestStatusBarHasNoModeChip(t *testing.T) {
	binds := []Keybind{{Key: "j/k", Label: "move"}}
	out := StatusBar(80, binds, StatusBadge{})
	for _, mode := range []string{"NORMAL", "INSERT", "COMMAND"} {
		if strings.Contains(out, mode) {
			t.Errorf("StatusBar output contains mode chip %q; want executable-key context only", mode)
		}
	}
}

func TestStatusBarKeepsHintsWholeAndIssueBadgeBounded(t *testing.T) {
	binds := []Keybind{
		{Key: "a1", Label: "alpha-action"},
		{Key: "b2", Label: "bravo-action"},
		{Key: "c3", Label: "charlie-action"},
		{Key: "d4", Label: "delta-action"},
	}
	badge := StatusBadge{Full: "⚠ 2 issues · ! details", Compact: "⚠2 !", Warning: true}
	if got := lipgloss.Width(badge.Full); got > maxStatusBadgeWidth {
		t.Fatalf("full issue badge is %d cells, want <= %d", got, maxStatusBadgeWidth)
	}

	for width := 20; width <= 120; width++ {
		view := ansi.Strip(StatusBar(width, binds, badge))
		if strings.Contains(view, "…") {
			t.Fatalf("width %d introduced partial status content: %q", width, view)
		}
		dropped := false
		for _, bind := range binds {
			hint := bind.Key + " " + bind.Label
			present := strings.Contains(view, hint)
			if dropped && present {
				t.Fatalf("width %d kept %q after dropping a hint to its left: %q", width, hint, view)
			}
			if !present {
				dropped = true
			}
			if strings.Contains(view, bind.Label) != present {
				t.Fatalf("width %d rendered a partial hint for %q: %q", width, hint, view)
			}
		}
		if !strings.Contains(view, badge.Full) && !strings.Contains(view, badge.Compact) {
			t.Fatalf("width %d omitted both complete badge forms: %q", width, view)
		}
	}
}
