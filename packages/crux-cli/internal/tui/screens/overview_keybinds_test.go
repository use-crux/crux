package screens

import "testing"

// TestOverviewKeybindsUseSuitesMnemonic asserts that the Overview screen's
// keybind hints route to `g s` (suites) — the legacy `g d` (datasets) hint
// must not appear because the canonical noun is Suite.
func TestOverviewKeybindsUseSuitesMnemonic(t *testing.T) {
	o := NewOverview()
	binds := o.Keybinds()
	for _, b := range binds {
		if b.Key == "g d" {
			t.Errorf("Overview keybind %q = %q present; want absent (g d is the legacy datasets mnemonic)", b.Key, b.Label)
		}
	}
	hasGs := false
	for _, b := range binds {
		if b.Key == "g s" && b.Label == "suites" {
			hasGs = true
			break
		}
	}
	if !hasGs {
		t.Errorf("Overview keybinds missing {Key:\"g s\", Label:\"suites\"} hint")
	}
}
