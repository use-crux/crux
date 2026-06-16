package tui

import "testing"

// TestWorkbenchGdIsNotDatasetAlias asserts that `g d` no longer maps
// to suites (the old "datasets" back-compat alias). It MAY map to
// something else (currently index/definitions, per S15) — but it
// must not be an alias for `g s`.
func TestWorkbenchGdIsNotDatasetAlias(t *testing.T) {
	if id, ok := navIDByGoKey["d"]; ok && id == "suites" {
		t.Errorf("navIDByGoKey[\"d\"] = %q — the datasets→suites back-compat alias must stay removed", id)
	}
}

// TestWorkbenchGdRoutesToIndex asserts the freed `g d` slot now
// routes to the Index (definitions) screen — see plan S15.
func TestWorkbenchGdRoutesToIndex(t *testing.T) {
	id, ok := navIDByGoKey["d"]
	if !ok {
		t.Fatal("navIDByGoKey[\"d\"] missing — should map to index per S15")
	}
	if id != "index" {
		t.Errorf("navIDByGoKey[\"d\"] = %q, want %q", id, "index")
	}
}

// TestWorkbenchGsMnemonicNoSuites asserts that `g s` no longer routes to a
// suites screen — suites were removed with the legacy quality surface.
func TestWorkbenchGsMnemonicNoSuites(t *testing.T) {
	if id, ok := navIDByGoKey["s"]; ok && id == "suites" {
		t.Errorf("navIDByGoKey[\"s\"] = %q — suites screen was removed", id)
	}
}
