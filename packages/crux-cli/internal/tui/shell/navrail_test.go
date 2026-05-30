package shell

import "testing"

// TestNavRailLabelsSuites asserts the nav-rail item for the suites route
// uses the canonical "Suites" label (not the legacy "Datasets" wording). The
// canonical noun for the focused records is Suite — see CONTEXT.md.
func TestNavRailLabelsSuites(t *testing.T) {
	var got *NavItem
	for i := range DefaultNav {
		if DefaultNav[i].ID == "suites" {
			got = &DefaultNav[i]
			break
		}
	}
	if got == nil {
		t.Fatal("DefaultNav has no item with ID=\"suites\"")
	}
	if got.Label != "Suites" {
		t.Errorf("nav-rail label for suites = %q, want %q", got.Label, "Suites")
	}
}
