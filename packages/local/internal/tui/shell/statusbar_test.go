package shell

import (
	"strings"
	"testing"
)

// TestStatusBarHasNoModeChip asserts the status bar no longer renders a
// mode-name chip (NORMAL/INSERT/COMMAND). The approved 2026-07-16 TUI
// stabilization design makes the status bar pure executable-key context.
func TestStatusBarHasNoModeChip(t *testing.T) {
	binds := []Keybind{{Key: "j/k", Label: "move"}}
	out := StatusBar(80, binds, ".crux/evals")
	for _, mode := range []string{"NORMAL", "INSERT", "COMMAND"} {
		if strings.Contains(out, mode) {
			t.Errorf("StatusBar output contains mode chip %q; want executable-key context only", mode)
		}
	}
}
