package screens

import "testing"

// TestExperimentsKeybindsDropUnbuiltNAndR asserts the Experiments
// screen no longer advertises `n new` and `r re-run` in its Keybinds()
// output — those depend on `StartExperiment` / `RerunExperiment`
// backend service methods which don't exist yet. Per KEYBINDS.md the
// status bar must not lie about what's pressable. The palette still
// exposes these as commands (which toast "backend pending") so users
// have a workaround. See S8 in the plan.
func TestExperimentsKeybindsDropUnbuiltNAndR(t *testing.T) {
	e := NewExperiments()
	binds := e.Keybinds()
	for _, b := range binds {
		if b.Key == "n" && b.Label == "new" {
			t.Errorf("Experiments keybind `n new` is still advertised — backend (StartExperiment) is not wired")
		}
		if b.Key == "r" && b.Label == "re-run" {
			t.Errorf("Experiments keybind `r re-run` is still advertised — backend (RerunExperiment) is not wired")
		}
	}
}
