package screens

import "testing"

// TestSuitesKeybindLabelsUseSuite asserts that the Suites screen's
// browse-mode keybind labels use "suite", not the legacy "dataset".
// The capital-letter J/K cycles suites; its label should say so.
func TestSuitesKeybindLabelsUseSuite(t *testing.T) {
	d := NewDatasets()
	binds := d.Keybinds()
	for _, b := range binds {
		if b.Label == "dataset" {
			t.Errorf("keybind %q has label %q; want %q", b.Key, b.Label, "suite")
		}
	}
	hasJK := false
	for _, b := range binds {
		if b.Key == "J/K" && b.Label == "suite" {
			hasJK = true
			break
		}
	}
	if !hasJK {
		t.Errorf("Suites keybinds missing {Key:\"J/K\", Label:\"suite\"}")
	}
}
