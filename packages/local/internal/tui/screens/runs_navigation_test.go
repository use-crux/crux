package screens

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestRunsKeepsExactRouteTargetOutsideLoadedList(t *testing.T) {
	runs := NewRuns()
	runs.Focus("run", "run-outside-current-page")

	cmd := runs.Update(testContext, runsListLoadedMsg{
		api.InspectRunRecord{TraceID: "first-visible-run"},
		api.InspectRunRecord{TraceID: "second-visible-run"},
	}, nil)

	if got := runs.SelectedRunID(); got != "run-outside-current-page" {
		t.Fatalf("selected run = %q, want exact route target", got)
	}
	if cmd == nil {
		t.Fatal("exact route target did not schedule direct detail fetch")
	}
	selected, _, ok := runs.runList.Cursor()
	if !ok || selected.TraceID != "run-outside-current-page" {
		t.Fatalf("visible list cursor = (%q, %v), want explicit exact route row", selected.TraceID, ok)
	}
	if got := runs.Counts()["runs"]; got != 2 {
		t.Fatalf("server-backed run count = %d, want 2", got)
	}
	runs.cycleRun(testContext, nil, +1)
	if got := runs.SelectedRunID(); got != "first-visible-run" {
		t.Fatalf("first downward movement selected %q, want first loaded row", got)
	}
}

func TestRunsFocusRepresentsOffPageTargetBeforeRefresh(t *testing.T) {
	runs := NewRuns()
	runs.Update(testContext, runsListLoadedMsg{
		api.InspectRunRecord{TraceID: "first-visible-run"},
		api.InspectRunRecord{TraceID: "second-visible-run"},
	}, nil)

	runs.Focus("run", "run-outside-current-page")

	selected, _, ok := runs.runList.Cursor()
	if !ok || selected.TraceID != "run-outside-current-page" {
		t.Fatalf("immediate list cursor = (%q, %v), want explicit exact route row", selected.TraceID, ok)
	}
	if got := runs.Counts()["runs"]; got != 2 {
		t.Fatalf("server-backed run count = %d, want 2", got)
	}
}
