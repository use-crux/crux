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

func TestNavRailKeysPreserveEstablishedSlots(t *testing.T) {
	want := map[string]string{
		"overview": "1", "insights": "2", "runs": "3", "index": "4", "evals": "5",
	}
	for _, item := range DefaultNav {
		if item.Key != want[item.ID] {
			t.Errorf("DefaultNav %s key = %q, want %q", item.ID, item.Key, want[item.ID])
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
