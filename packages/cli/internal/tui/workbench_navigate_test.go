package tui

import (
	"testing"

	"github.com/use-crux/crux/packages/cli/internal/tui/screens"
)

// TestWorkbenchHandlesNavigateRequest asserts that when a screen emits a
// screens.NavigateRequest carrying a Kind/ID and a destination NavID,
// the workbench stages the selection AND switches active nav. This is
// the cross-screen drill protocol; see ADR-0051.
func TestWorkbenchHandlesNavigateRequest(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	w.screens["runs"] = &fakeScreen{id: "runs"}

	w.Update(screens.NavigateRequest{NavID: "runs", Kind: "run", ID: "8af2f1c"})

	if w.activeNav != "runs" {
		t.Errorf("activeNav = %q, want %q", w.activeNav, "runs")
	}
	if got := w.GetSelection(KindRun); got != "8af2f1c" {
		t.Errorf("workbench did not stage selection; GetSelection(run) = %q, want %q", got, "8af2f1c")
	}
}

// TestWorkbenchNavigateRequestNoStagingWhenKindEmpty asserts that a
// NavigateRequest with no Kind only switches active nav (no selection
// write). Used for nav-only drills like `g i` chord equivalents.
func TestWorkbenchNavigateRequestNoStagingWhenKindEmpty(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	w.screens["insights"] = &fakeScreen{id: "insights"}

	w.Update(screens.NavigateRequest{NavID: "insights"})

	if w.activeNav != "insights" {
		t.Errorf("activeNav = %q, want %q", w.activeNav, "insights")
	}
	// No selection store entries set.
	for _, k := range []Kind{KindRun, KindInsight, KindExperiment} {
		if got := w.GetSelection(k); got != "" {
			t.Errorf("nav-only request leaked selection for %q: %q", k, got)
		}
	}
}
