package screens

import (
	"context"
	"reflect"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type runsLocationClient struct {
	*uitest.FixtureClient
	detail api.ObservabilityRunDetail
}

func (c *runsLocationClient) ObservabilityRunDetail(context.Context, string) (api.ObservabilityRunDetail, bool, error) {
	return c.detail, true, nil
}

func TestRunsLocationNeverPairsRestoredRunWithAnotherRunsDetail(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs,
		api.ObservabilityRunSummary{RunID: "run-a", Name: "run A"},
		api.ObservabilityRunSummary{RunID: "run-b", Name: "run B"},
	)
	selectRunForTest(runs, "run-a")
	setRunDetailForTest(runs, locationRunDetail("run-a", "span-a", "current A detail"))
	selectSpanForTest(runs, "span-a")
	runs.setFocus(focusSpanDetail)
	want := runs.CaptureLocation()

	selectRunForTest(runs, "run-b")
	setRunDetailForTest(runs, locationRunDetail("run-b", "span-b", "stale B detail"))
	selectSpanForTest(runs, "span-b")
	runs.RestoreLocation(want)

	if got := runs.SelectedRunID(); got != "run-a" {
		t.Fatalf("restored run = %q, want run-a", got)
	}
	if got := runs.SelectedSpanID(); got != "" {
		t.Fatalf("restored run A retained another run's span %q before A reload", got)
	}
	if view := stripANSI(runs.View(Size{})); strings.Contains(view, "stale B detail") {
		t.Fatalf("restored run A rendered run B detail:\n%s", view)
	}
}

func TestRunsLocationReloadsCurrentDetailBeforeRestoringSpanAndAnchors(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs,
		api.ObservabilityRunSummary{RunID: "run-a", Name: "run A"},
		api.ObservabilityRunSummary{RunID: "run-b", Name: "run B"},
	)
	runs.Resize(Size{Width: 100, Height: 18})
	selectRunForTest(runs, "run-a")
	setRunDetailForTest(runs, locationRunDetail("run-a", "span-a", strings.Repeat("A detail ", 80)))
	selectSpanForTest(runs, "span-a")
	runs.setFocus(focusSpanDetail)
	runs.spanDocument.Update(tea.KeyPressMsg{Code: tea.KeyPgDown})
	want := runs.CaptureLocation()

	selectRunForTest(runs, "run-b")
	setRunDetailForTest(runs, locationRunDetail("run-b", "span-b", "stale B detail"))
	selectSpanForTest(runs, "span-b")

	refresher, ok := any(runs).(interface {
		RestoreLocationRefresh(context.Context, ScreenLocation, DataClient) tea.Cmd
	})
	if !ok {
		t.Fatal("Runs cannot reload current detail while restoring Back location")
	}
	client := &runsLocationClient{
		FixtureClient: uitest.NewFixtureClient(),
		detail:        locationRunDetail("run-a", "span-a", strings.Repeat("current A detail ", 80)),
	}
	client.detail.Run.Revision = 12
	cmd := refresher.RestoreLocationRefresh(testContext, want, client)
	if cmd == nil {
		t.Fatal("restoring run A over run B did not request current A detail")
	}
	if got := runs.SelectedSpanID(); got != "" {
		t.Fatalf("before reload, restored location retained stale span %q", got)
	}
	runs.Update(testContext, cmd(), client)

	got := runs.CaptureLocation()
	if got.FocusedPane != want.FocusedPane || !reflect.DeepEqual(got.SelectedIDs, want.SelectedIDs) {
		t.Fatalf("restored Runs identity = %#v, want %#v", got, want)
	}
	if !reflect.DeepEqual(got.Anchors, want.Anchors) {
		t.Fatalf("restored Runs anchors = %#v, want %#v", got.Anchors, want.Anchors)
	}
	activity := runs.currentActivity()
	if activity == nil || !strings.Contains(activity.Name, "current A detail") || strings.Contains(activity.Name, "stale B detail") {
		t.Fatalf("restored Runs activity did not use current A detail: %#v", activity)
	}
}

func TestRunsLocationDoesNotReplayPendingAnchorsAfterDetailRequestIsSuperseded(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs,
		api.ObservabilityRunSummary{RunID: "run-a", Name: "run A"},
		api.ObservabilityRunSummary{RunID: "run-b", Name: "run B"},
	)
	selectRunForTest(runs, "run-a")
	setRunDetailForTest(runs, locationRunDetailWithChild("run-a", "span-a", "original A"))
	selectSpanForTest(runs, "span-a")
	runs.setFocus(focusSpanDetail)
	location := runs.CaptureLocation()

	selectRunForTest(runs, "run-b")
	setRunDetailForTest(runs, locationRunDetail("run-b", "span-b", "current B"))
	client := &runsLocationClient{
		FixtureClient: uitest.NewFixtureClient(),
		detail:        locationRunDetailWithChild("run-a", "span-a", "current A"),
	}
	if cmd := runs.RestoreLocationRefresh(testContext, location, client); cmd == nil {
		t.Fatal("Back restoration did not start its detail request")
	}

	// Leaving and later re-entering starts a newer request for the same run.
	// User state established for that newer lifecycle must win over the stale
	// pending Back anchors.
	newer := runs.fetchRunDetail(testContext, client, "run-a")
	runs.setFocus(focusRuns)
	runs.Update(testContext, newer(), client)

	if got := runs.focus; got != focusRuns {
		t.Fatalf("superseding detail replayed stale Back focus %v", got)
	}
	if got := runs.SelectedSpanID(); got == "span-a" {
		t.Fatalf("superseding detail replayed stale Back span %q", got)
	}
}

func locationRunDetailWithChild(runID, childSpanID, name string) api.ObservabilityRunDetail {
	detail := locationRunDetail(runID, "root-"+runID, name+" root")
	detail.Root.Children = []api.ObservabilityRunDetailNode{{
		ID: "node-" + childSpanID,
		SpanSummary: api.ObservabilitySpanSummary{
			RunID: runID, SpanID: childSpanID, ParentSpanID: detail.Root.SpanID, Name: name + " child",
		},
	}}
	return detail
}

func locationRunDetail(runID, spanID, name string) api.ObservabilityRunDetail {
	return api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: runID, Name: name},
		Root: api.ObservabilityRunDetailNode{
			ID: "node-" + spanID,
			SpanSummary: api.ObservabilitySpanSummary{
				RunID: runID, SpanID: spanID, Name: name,
			},
		},
	}
}
