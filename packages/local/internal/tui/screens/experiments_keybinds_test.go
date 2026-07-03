package screens

import "testing"

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
