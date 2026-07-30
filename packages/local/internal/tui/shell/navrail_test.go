package shell

import (
	"strings"
	"testing"
)

// TestNavRailDropsDeadConcepts asserts the nav rail no longer carries the
// removed Suites and Compare screens — Evals are source-defined and Baseline
// comparisons live with Eval runs.
func TestNavRailDropsDeadConcepts(t *testing.T) {
	for i := range DefaultNav {
		switch DefaultNav[i].ID {
		case "suites", "compare":
			t.Errorf("DefaultNav still carries dead screen %q", DefaultNav[i].ID)
		}
	}
}

// TestNavRailKeysAreSequential asserts the numeric jump keys run 1..n in
// visual order so the digits match the rail top-to-bottom.
func TestNavRailKeysAreSequential(t *testing.T) {
	for i := range DefaultNav {
		want := string(rune('1' + i))
		if DefaultNav[i].Key != want {
			t.Errorf("DefaultNav[%d] (%s) key = %q, want %q", i, DefaultNav[i].ID, DefaultNav[i].Key, want)
		}
	}
}

func TestNavRailOmitsEmptyFooterBlocks(t *testing.T) {
	view := NavRail(30, DefaultNav, "overview", NavRailFooter{TargetKind: "agent"})
	for _, dead := range []string{"TARGET", "BASELINE", "(none)"} {
		if strings.Contains(view, dead) {
			t.Errorf("empty nav footer rendered %q:\n%s", dead, view)
		}
	}
}
