package tui

import "testing"

func TestWorkbenchGpRoutesToIndex(t *testing.T) {
	id, ok := navIDByGoKey["p"]
	if !ok {
		t.Fatal("navIDByGoKey[\"p\"] missing — should map to index")
	}
	if id != "index" {
		t.Errorf("navIDByGoKey[\"p\"] = %q, want %q", id, "index")
	}
}

// TestWorkbenchGsMnemonicNoSuites asserts that `g s` no longer routes to a
// suites screen — suites were removed with the legacy quality surface.
func TestWorkbenchGsMnemonicNoSuites(t *testing.T) {
	if id, ok := navIDByGoKey["s"]; ok && id == "suites" {
		t.Errorf("navIDByGoKey[\"s\"] = %q — suites screen was removed", id)
	}
}
