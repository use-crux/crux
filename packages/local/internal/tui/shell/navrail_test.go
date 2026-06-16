package shell

import "testing"

// TestNavRailDropsDeadConcepts asserts the nav rail no longer carries the
// pre-spec-02 Suites and Compare screens — evaluations are source-defined
// and comparisons live inside each experiment record now.
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
