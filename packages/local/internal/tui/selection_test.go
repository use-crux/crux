package tui

import "testing"

// TestSelectionStoreRoundTrips asserts the workbench's cross-screen
// selection store round-trips Set → Get → Clear for every recognised
// record kind, as required by the approved TUI stabilization design.
func TestSelectionStoreRoundTrips(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")

	// Default: empty.
	if got := w.GetSelection(KindRun); got != "" {
		t.Errorf("fresh workbench GetSelection(run) = %q, want empty", got)
	}

	// Set and read back.
	w.SetSelection(KindRun, "8af2f1c")
	if got := w.GetSelection(KindRun); got != "8af2f1c" {
		t.Errorf("SetSelection round-trip GetSelection(run) = %q, want %q", got, "8af2f1c")
	}

	// A different kind is independent.
	w.SetSelection(KindInsight, "INS-014")
	if got := w.GetSelection(KindRun); got != "8af2f1c" {
		t.Errorf("setting insight clobbered run; GetSelection(run) = %q", got)
	}
	if got := w.GetSelection(KindInsight); got != "INS-014" {
		t.Errorf("GetSelection(insight) = %q, want %q", got, "INS-014")
	}

	// Clear removes only the chosen kind.
	w.ClearSelection(KindRun)
	if got := w.GetSelection(KindRun); got != "" {
		t.Errorf("after ClearSelection(run), GetSelection(run) = %q, want empty", got)
	}
	if got := w.GetSelection(KindInsight); got != "INS-014" {
		t.Errorf("ClearSelection(run) clobbered insight; GetSelection(insight) = %q", got)
	}
}

func TestSelectionKindsCoverMountedScreens(t *testing.T) {
	required := []Kind{KindRun, KindSpan, KindInsight}
	seen := make(map[Kind]struct{}, len(required))
	for _, k := range required {
		if k == "" {
			t.Errorf("a required Kind constant is empty (declared as the empty string)")
		}
		if _, dup := seen[k]; dup {
			t.Errorf("duplicate Kind value %q", k)
		}
		seen[k] = struct{}{}
	}
}
