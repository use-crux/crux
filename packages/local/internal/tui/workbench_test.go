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

// TestWorkbenchGdRoutesToDatasets asserts the Datasets screen owns the
// natural `g d` mnemonic now that it is part of the nav rail again.
func TestWorkbenchGdRoutesToDatasets(t *testing.T) {
	id, ok := navIDByGoKey["d"]
	if !ok {
		t.Fatal("navIDByGoKey[\"d\"] missing — should map to datasets")
	}
	if id != "datasets" {
		t.Errorf("navIDByGoKey[\"d\"] = %q, want %q", id, "datasets")
	}
}

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
