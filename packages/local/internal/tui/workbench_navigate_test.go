package tui

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

// TestWorkbenchHandlesNavigateRequest asserts that a cross-screen drill sends
// its exact route parameter directly to a destination that owns focus.
func TestWorkbenchHandlesNavigateRequest(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	fake := &fakeScreen{id: "runs"}
	w.screens["runs"] = fake

	w.Update(screens.NavigateRequest{NavID: "runs", Kind: "run", ID: "8af2f1c"})

	if w.activeNav != "runs" {
		t.Errorf("activeNav = %q, want %q", w.activeNav, "runs")
	}
	if len(fake.focusCalls) != 1 || fake.focusCalls[0] != (focusCall{kind: "run", id: "8af2f1c"}) {
		t.Fatalf("focus calls = %#v, want exact run route parameter", fake.focusCalls)
	}
	if got := w.GetSelection(KindRun); got != "" {
		t.Errorf("migrated route leaked into legacy selection store: %q", got)
	}
}

// TestWorkbenchNavigateRequestNoStagingWhenKindEmpty asserts that a
// NavigateRequest with no Kind only switches active nav (no selection
// write). Used for nav-only drills like `g i` chord equivalents.
func TestWorkbenchNavigateRequestNoStagingWhenKindEmpty(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.screens["insights"] = &fakeScreen{id: "insights"}

	w.Update(screens.NavigateRequest{NavID: "insights"})

	if w.activeNav != "insights" {
		t.Errorf("activeNav = %q, want %q", w.activeNav, "insights")
	}
	// No selection store entries set.
	for _, k := range []Kind{KindRun, KindInsight} {
		if got := w.GetSelection(k); got != "" {
			t.Errorf("nav-only request leaked selection for %q: %q", k, got)
		}
	}
}

func TestGotoNavCurrentRoutePreservesExactTargetAndBackHistory(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.screens["runs"] = &fakeScreen{id: "runs"}
	exact := NavTarget{NavID: "runs", Kind: KindRun, ID: "run-exact"}

	w.gotoTarget(exact)
	w.gotoNav("runs")

	if w.activeTarget != exact {
		t.Fatalf("current-route shortcut changed target to %#v, want %#v", w.activeTarget, exact)
	}
	if len(w.history) != 1 {
		t.Fatalf("history length = %d, want one Overview location", len(w.history))
	}
	w.goBack()
	if w.activeNav != "overview" {
		t.Fatalf("Back active nav = %q, want overview", w.activeNav)
	}
}
