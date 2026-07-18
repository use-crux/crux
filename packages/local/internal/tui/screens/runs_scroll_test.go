package screens

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// TestRunsListScrollsWithCursor asserts that when the run cursor moves
// past the visible window, the list scrolls so the cursor stays in
// view. Before the fix the cursor's selRun changed but listScroll
// stayed at 0, so the runs visible were always the first N regardless
// of where the cursor was.
func TestRunsListScrollsWithCursor(t *testing.T) {
	r := NewRuns()
	// 10 runs, list pane visible capacity = 3 (= 6 rows ÷ 2 rows/run).
	values := make([]api.ObservabilityRunSummary, 10)
	for i := range values {
		values[i] = api.ObservabilityRunSummary{RunID: tabbedID(i)}
	}
	setRunsForTest(r, values...)
	r.selRun = values[0].RunID
	r.runList.SetItems(values)
	r.runList.SetHeight(6)

	// Move cursor down 5 times — past the visible window (capacity 3).
	for i := 0; i < 5; i++ {
		r.cycleRun(testContext, nil, +1)
	}

	if r.selRun != values[5].RunID {
		t.Errorf("cursor index = %q, want %q", r.selRun, values[5].RunID)
	}
	// After 5 down-moves with capacity 3, scroll should have advanced
	// enough to keep index 5 visible — i.e. scroll >= 3 (so index 5 is
	// inside [scroll, scroll+3)).
	if got := r.runList.Offset(); got < 3 {
		t.Errorf("offset = %d, want >= 3 (cursor at index 5 must be visible)", got)
	}
	if got := r.runList.Offset(); got > 5 {
		t.Errorf("offset = %d, want <= 5 (no need to scroll past cursor)", got)
	}
}

// TestRunsListScrollsBackUp asserts moving the cursor back up scrolls
// the list up too.
func TestRunsListScrollsBackUp(t *testing.T) {
	r := NewRuns()
	values := make([]api.ObservabilityRunSummary, 10)
	for i := range values {
		values[i] = api.ObservabilityRunSummary{RunID: tabbedID(i)}
	}
	setRunsForTest(r, values...)
	r.selRun = values[8].RunID
	r.runList.SetItems(values)
	r.runList.SetHeight(6)
	r.runList.SetCursorByIdentity(r.selRun)

	// Cursor back up to index 1 — scroll should follow.
	for i := 0; i < 7; i++ {
		r.cycleRun(testContext, nil, -1)
	}

	if r.selRun != values[1].RunID {
		t.Errorf("cursor index = %q, want %q", r.selRun, values[1].RunID)
	}
	if got := r.runList.Offset(); got > 1 {
		t.Errorf("offset = %d, want <= 1 (cursor at index 1 must be visible)", got)
	}
}

func tabbedID(i int) string {
	// Distinct 7-char ids so the runs feel real.
	digits := "0123456789"
	c := digits[i%10]
	return "run-" + string([]byte{c, c, c}) + "00"
}
