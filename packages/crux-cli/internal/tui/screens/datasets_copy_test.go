package screens

import (
	"strings"
	"testing"
)

// TestSuitesViewUsesSuitesNoun asserts that user-visible copy on the
// Suites screen (loading state + empty state) uses the canonical noun
// "suite" / "suites", not the legacy "dataset" / "datasets".
func TestSuitesViewUsesSuitesNoun(t *testing.T) {
	t.Run("loading", func(t *testing.T) {
		d := NewDatasets()
		// loaded == false → loading state
		out := d.View(Size{Width: 80, Height: 24})
		if strings.Contains(strings.ToLower(out), "dataset") {
			t.Errorf("loading state contains \"dataset\": %q", out)
		}
		if !strings.Contains(strings.ToLower(out), "suite") {
			t.Errorf("loading state missing \"suite\" noun: %q", out)
		}
	})

	t.Run("empty", func(t *testing.T) {
		d := NewDatasets()
		d.loaded = true
		// items empty → empty-state copy
		out := d.View(Size{Width: 80, Height: 24})
		if strings.Contains(strings.ToLower(out), "dataset") {
			t.Errorf("empty state contains \"dataset\": %q", out)
		}
		if !strings.Contains(strings.ToLower(out), "suite") {
			t.Errorf("empty state missing \"suite\" noun: %q", out)
		}
	})
}
