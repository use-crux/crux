package screens

import (
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestRunsListPanePageNavigationPreservesSelectionOnRefresh(t *testing.T) {
	runs := NewRuns()
	values := make([]api.ObservabilityRunSummary, 10)
	for i := range values {
		values[i] = api.ObservabilityRunSummary{RunID: tabbedID(i)}
	}
	runs.Update(testContext, runsListLoadedForTest(runs, values...), nil)
	viewRunsForTest(runs, Size{Width: 70, Height: 10})

	runs.Update(testContext, tea.KeyPressMsg{Code: tea.KeyPgDown}, nil)
	selected := runs.SelectedRunID()
	if selected == "" || selected == values[0].RunID {
		t.Fatalf("page down selected %q, want a later run", selected)
	}
	if got := runs.runList.Position().Offset; got == 0 {
		t.Fatal("page down did not scroll the run list")
	}
	viewRunsForTest(runs, Size{Width: 100, Height: 6})
	if got := runs.SelectedRunID(); got != selected {
		t.Fatalf("selection after resize = %q, want stable identity %q", got, selected)
	}

	refreshed := append([]api.ObservabilityRunSummary(nil), values...)
	for left, right := 0, len(refreshed)-1; left < right; left, right = left+1, right-1 {
		refreshed[left], refreshed[right] = refreshed[right], refreshed[left]
	}
	runs.Update(testContext, runsListLoadedForTest(runs, refreshed...), nil)
	if got := runs.SelectedRunID(); got != selected {
		t.Fatalf("selection after refresh = %q, want stable identity %q", got, selected)
	}
}

func TestRunsListPaneFilterChoosesAdjacentRun(t *testing.T) {
	runs := NewRuns()
	values := []api.ObservabilityRunSummary{
		{RunID: "a", Name: "visible"},
		{RunID: "b", Name: "hidden"},
		{RunID: "c", Name: "visible"},
		{RunID: "d", Name: "visible"},
	}
	runs.Update(testContext, runsListLoadedForTest(runs, values...), nil)
	runs.Update(testContext, tea.KeyPressMsg{Text: "j", Code: 'j'}, nil)
	runs.filters.Query = "visible"

	runs.ensureFilteredRunSelection(testContext, nil)

	if got := runs.SelectedRunID(); got != "c" {
		t.Fatalf("selection after filtering out b = %q, want adjacent run c", got)
	}
}

func TestRunsListPaneRefreshReconcilesActiveFilter(t *testing.T) {
	runs := NewRuns()
	values := []api.ObservabilityRunSummary{
		{RunID: "a", Name: "visible"},
		{RunID: "b", Name: "visible"},
		{RunID: "c", Name: "visible"},
	}
	runs.Update(testContext, runsListLoadedForTest(runs, values...), nil)
	runs.Update(testContext, tea.KeyPressMsg{Text: "j", Code: 'j'}, nil)
	runs.filters.Query = "visible"
	runs.ensureFilteredRunSelection(testContext, nil)

	runs.Update(testContext, runsListLoadedForTest(runs,
		api.ObservabilityRunSummary{RunID: "a", Name: "visible"},
		api.ObservabilityRunSummary{RunID: "b", Name: "hidden"},
		api.ObservabilityRunSummary{RunID: "c", Name: "visible"},
	), nil)

	if got := runs.SelectedRunID(); got != "c" {
		t.Fatalf("selection after refresh filtered out b = %q, want adjacent run c", got)
	}
}

func TestRunsListPaneRefreshChoosesNeighborWhenRunDisappears(t *testing.T) {
	runs := NewRuns()
	values := []api.ObservabilityRunSummary{
		{RunID: "a"},
		{RunID: "b"},
		{RunID: "c"},
	}
	runs.Update(testContext, runsListLoadedForTest(runs, values...), nil)
	runs.Update(testContext, tea.KeyPressMsg{Text: "j", Code: 'j'}, nil)

	runs.Update(testContext, runsListLoadedForTest(runs,
		api.ObservabilityRunSummary{RunID: "a"},
		api.ObservabilityRunSummary{RunID: "c"},
	), nil)

	if got := runs.SelectedRunID(); got != "c" {
		t.Fatalf("selection after b disappeared = %q, want adjacent run c", got)
	}
}

func TestRunsListPaneNavigationFollowsFocus(t *testing.T) {
	for name, msg := range map[string]tea.Msg{
		"keyboard": tea.KeyPressMsg{Code: tea.KeyPgDown},
		"mouse":    tea.MouseWheelMsg{Button: tea.MouseWheelDown},
	} {
		t.Run(name, func(t *testing.T) {
			runs := NewRuns()
			values := make([]api.ObservabilityRunSummary, 8)
			for i := range values {
				values[i] = api.ObservabilityRunSummary{RunID: tabbedID(i)}
			}
			runs.Update(testContext, runsListLoadedForTest(runs, values...), nil)
			viewRunsForTest(runs, Size{Width: 70, Height: 10})
			runs.shiftFocus(1)

			runs.Update(testContext, msg, nil)
			if got := runs.SelectedRunID(); got != values[0].RunID {
				t.Fatalf("unfocused list selected %q, want %q", got, values[0].RunID)
			}

			runs.shiftFocus(-1)
			runs.Update(testContext, msg, nil)
			if got := runs.SelectedRunID(); got == values[0].RunID {
				t.Fatalf("focused list did not consume %s navigation", name)
			}
		})
	}
}

func TestRunsListPaneLineNavigationConsumesExactlyOnce(t *testing.T) {
	runs := NewRuns()
	values := []api.ObservabilityRunSummary{
		{RunID: "a"},
		{RunID: "b"},
		{RunID: "c"},
		{RunID: "d"},
	}
	runs.Update(testContext, runsListLoadedForTest(runs, values...), nil)
	down := tea.KeyPressMsg{Text: "j", Code: 'j'}

	runs.Update(testContext, down, nil)
	if got := runs.SelectedRunID(); got != "b" {
		t.Fatalf("one j selected %q, want exactly the next row b", got)
	}

	runs.shiftFocus(1)
	runs.Update(testContext, down, nil)
	if got := runs.SelectedRunID(); got != "b" {
		t.Fatalf("unfocused run list selected %q, want b", got)
	}
}

func TestRunsListRenderingReflectsResizeAdjustedOffset(t *testing.T) {
	runs := NewRuns()
	values := make([]api.ObservabilityRunSummary, 10)
	for i := range values {
		values[i] = api.ObservabilityRunSummary{
			RunID: fmt.Sprintf("run-%02d", i),
			Name:  fmt.Sprintf("run name %02d", i),
		}
	}
	setRunsForTest(runs, values...)

	tall := Size{Width: 70, Height: 14}
	short := Size{Width: 70, Height: 6}
	runs.Resize(tall)
	runs.Update(testContext, tea.KeyPressMsg{Code: tea.KeyEnd}, nil)
	tallList := runs.layout.list

	runs.Resize(short)
	shortList := runs.layout.list
	runs.renderListLines(shortList)
	runs.Resize(tall)
	tallList = runs.layout.list
	got := runs.renderListLines(tallList)
	want := blockLines(runs.renderList(tallList.W, tallList.H), tallList)

	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatal("returning to the tall rectangle rendered rows for its stale list offset")
	}
}

// TestRunsListScrollsWithCursor asserts that when the run cursor moves
// past the visible window, the list scrolls so the cursor stays in
// view. Before the fix semantic selection changed but listScroll stayed at 0,
// so the runs visible were always the first N regardless of cursor position.
func TestRunsListScrollsWithCursor(t *testing.T) {
	r := NewRuns()
	// 10 runs, list pane visible capacity = 3 (= 6 rows ÷ 2 rows/run).
	values := make([]api.ObservabilityRunSummary, 10)
	for i := range values {
		values[i] = api.ObservabilityRunSummary{RunID: tabbedID(i)}
	}
	setRunsForTest(r, values...)
	r.runList.SetItems(values)
	r.runList.Select(values[0].RunID)
	r.runList.SetSize(0, 6)

	// Move cursor down 5 times — past the visible window (capacity 3).
	for i := 0; i < 5; i++ {
		r.cycleRun(testContext, nil, +1)
	}

	if got := r.SelectedRunID(); got != values[5].RunID {
		t.Errorf("cursor index = %q, want %q", got, values[5].RunID)
	}
	// After 5 down-moves with capacity 3, scroll should have advanced
	// enough to keep index 5 visible — i.e. scroll >= 3 (so index 5 is
	// inside [scroll, scroll+3)).
	if got := r.runList.Position().Offset; got < 3 {
		t.Errorf("offset = %d, want >= 3 (cursor at index 5 must be visible)", got)
	}
	if got := r.runList.Position().Offset; got > 5 {
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
	r.runList.SetItems(values)
	r.runList.SetSize(0, 6)
	r.runList.Select(values[8].RunID)

	// Cursor back up to index 1 — scroll should follow.
	for i := 0; i < 7; i++ {
		r.cycleRun(testContext, nil, -1)
	}

	if got := r.SelectedRunID(); got != values[1].RunID {
		t.Errorf("cursor index = %q, want %q", got, values[1].RunID)
	}
	if got := r.runList.Position().Offset; got > 1 {
		t.Errorf("offset = %d, want <= 1 (cursor at index 1 must be visible)", got)
	}
}

func tabbedID(i int) string {
	// Distinct 7-char ids so the runs feel real.
	digits := "0123456789"
	c := digits[i%10]
	return "run-" + string([]byte{c, c, c}) + "00"
}
