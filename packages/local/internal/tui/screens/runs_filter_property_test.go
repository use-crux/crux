package screens

import (
	"fmt"
	"math/rand"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestRunsAcceptedValueInvalidatesProjectionForSameRequestAndRevision(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs)

	message := runsListLoadedForTest(runs,
		api.ObservabilityRunSummary{RunID: "run-a", Name: "first"},
		api.ObservabilityRunSummary{RunID: "run-b", Name: "second"},
	)
	if got := len(runs.filteredRuns()); got != 0 {
		t.Fatalf("retained pre-refresh rows = %d, want empty", got)
	}
	runs.Update(testContext, message, nil)

	if got := len(runs.filteredRuns()); got != 2 {
		t.Fatalf("accepted same-revision rows = %d, want 2", got)
	}
	if got := runs.runList.Position().Total; got != 2 {
		t.Fatalf("rendered pane rows = %d, want 2", got)
	}
}

func TestRunsVisibleProjectionInvariantAcrossFilterAndNavigationSequences(t *testing.T) {
	fixedNow := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	previousNow := runsListNow
	runsListNow = func() time.Time { return fixedNow }
	t.Cleanup(func() { runsListNow = previousNow })

	values := make([]api.ObservabilityRunSummary, 100)
	statuses := []string{"ok", "error", "running"}
	models := []string{"gpt-a", "gpt-b"}
	sessions := []string{"session-a", "session-b"}
	for index := range values {
		values[index] = api.ObservabilityRunSummary{
			RunID:     fmt.Sprintf("run-%03d", index),
			Name:      fmt.Sprintf("trace %03d", index),
			Status:    statuses[index%len(statuses)],
			Model:     models[index%len(models)],
			SessionID: sessions[index%len(sessions)],
			StartedAt: fixedNow.Add(-time.Duration(index) * time.Minute).Format(time.RFC3339Nano),
		}
	}

	runs := NewRuns()
	setRunsForTest(runs, values...)
	runs.Resize(Size{Width: 100, Height: 30})
	random := rand.New(rand.NewSource(7))
	for step := 0; step < 500; step++ {
		switch random.Intn(7) {
		case 0:
			runs.runQuery = []string{"", "trace 00", "missing"}[random.Intn(3)]
		case 1:
			runs.runStatusIndex = random.Intn(len(runStatusFilters))
		case 2:
			runs.runWindowIndex = random.Intn(len(runWindows))
		case 3:
			runs.runGroupIndex = random.Intn(len(runGroups))
		case 4:
			runs.sessionFilter = []string{"", "session-a", "session-b"}[random.Intn(3)]
		case 5:
			runs.modelFilter = []string{"", "gpt-a", "gpt-b"}[random.Intn(3)]
		case 6:
			// Navigation discards only transient pane rows. The resource and
			// filters remain authoritative when the screen regains focus.
			runs.runList.SetItems(nil)
			runs.Refresh(testContext, nil, nil)
		}
		runs.ensureFilteredRunSelection(testContext, nil)
		visible := runs.filteredRuns()
		if got := runs.runList.Position().Total; got != len(visible) {
			t.Fatalf("step %d: pane rows = %d, derived rows = %d", step, got, len(visible))
		}
		_, count := runs.Breadcrumb()
		wantPrefix := fmt.Sprintf("%d ", len(visible))
		if !strings.HasPrefix(count, wantPrefix) {
			t.Fatalf("step %d: header %q, want prefix %q", step, count, wantPrefix)
		}
		view := stripANSI(runs.View(Size{}))
		if len(visible) > 0 && strings.Contains(view, "No runs") {
			t.Fatalf("step %d: non-empty projection rendered empty state:\n%s", step, view)
		}
	}
}
