package shell

import (
	"strings"
	"testing"
)

// TestStatusBarHasNoModeChip asserts the status bar no longer renders a
// mode-name chip (NORMAL/INSERT/COMMAND). Per ADR-0050, the TUI is
// modeless; the status bar is pure keybind context.
func TestStatusBarHasNoModeChip(t *testing.T) {
	binds := []Keybind{{Key: "j/k", Label: "move"}}
	out := StatusBar(80, binds, ".crux/quality")
	for _, mode := range []string{"NORMAL", "INSERT", "COMMAND"} {
		if strings.Contains(out, mode) {
			t.Errorf("StatusBar output contains mode chip %q — should be modeless per ADR-0050", mode)
		}
	}
}
