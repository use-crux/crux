package screens

import (
	"strings"
	"testing"
)

// TestExperimentsKeybindsHideDeferredActions asserts the Experiments screen
// only advertises actions backed by existing screen or service surfaces.
func TestExperimentsKeybindsHideDeferredActions(t *testing.T) {
	e := NewExperiments()
	binds := e.Keybinds()
	for _, b := range binds {
		for _, deferred := range []string{"n", "r", "c"} {
			if b.Key == deferred {
				t.Errorf("Experiments keybind %q is still advertised; deferred actions belong to Phase 18", deferred)
			}
		}
	}
}

func TestExperimentsKeybindsAdvertiseCSVExport(t *testing.T) {
	e := NewExperiments()
	binds := make([]string, 0, len(e.Keybinds()))
	for _, b := range e.Keybinds() {
		binds = append(binds, b.Key+" "+b.Label)
	}
	text := strings.Join(binds, " · ")
	if !strings.Contains(text, "e export CSV") {
		t.Fatalf("Experiments keybinds should advertise CSV export, got: %s", text)
	}
	if strings.Contains(text, "export JSON") {
		t.Fatalf("Experiments keybinds still advertise JSON fallback: %s", text)
	}
}
