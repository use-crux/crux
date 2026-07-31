package screens

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestRunsGroupingPreservesSelectionAndRendersRollupHeader(t *testing.T) {
	runs := NewRuns()
	values := []api.ObservabilityRunSummary{
		phaseBRun("run-a", "session-a", "generation.call", "answer", "ok", 1_000, 1_000, 0.01),
		phaseBRun("run-b", "session-b", "flow.run", "flow", "ok", 4_000, 4_000, 0.04),
		phaseBRun("run-c", "session-a", "generation.call", "answer", "error", 2_000, 2_000, 0.02),
	}
	setRunsForTest(runs, values...)
	selectRunForTest(runs, "run-c")

	for range 3 {
		runs.cycleRunGroup(testContext, nil)
	}

	if got := runs.SelectedRunID(); got != "run-c" {
		t.Fatalf("selection after regrouping = %q, want run-c", got)
	}
	out := stripANSI(viewRunsForTest(runs, Size{Width: 160, Height: 30}))
	for _, want := range []string{
		"SESSION session-a",
		"2 runs",
		"1 fail",
		"Σ3k tok",
		"Σ$0.030",
		"avg 1.5s",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("session group header omitted %q:\n%s", want, out)
		}
	}
}

type phaseBFilterClient struct {
	*uitest.FixtureClient
	pageOptions    []api.InspectRunsOptions
	inspectOptions []api.InspectRunsOptions
}

func (c *phaseBFilterClient) ObservabilityRunsPageWithOptions(
	ctx context.Context,
	options api.InspectRunsOptions,
	definitionID ...string,
) (api.ObservabilityRunsPage, error) {
	c.pageOptions = append(c.pageOptions, options)
	return c.FixtureClient.ObservabilityRunsPageWithOptions(ctx, options, definitionID...)
}

func (c *phaseBFilterClient) RunsWithOptions(
	ctx context.Context,
	options api.InspectRunsOptions,
) ([]api.InspectRunRecord, error) {
	c.inspectOptions = append(c.inspectOptions, options)
	return c.FixtureClient.RunsWithOptions(ctx, options)
}

func TestRunsServerFilterOptionsRoundTrip(t *testing.T) {
	client := &phaseBFilterClient{FixtureClient: uitest.NewFixtureClient()}
	runs := NewRuns()
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	previousNow := runsListNow
	runsListNow = func() time.Time { return now }
	t.Cleanup(func() { runsListNow = previousNow })

	runs.runStatusIndex = 2
	runs.runWindowIndex = 1
	runs.sessionFilter = "session_docs"
	runs.modelFilter = "gpt-5"
	msg := runs.fetchRunsList(testContext, client)()
	if msg == nil {
		t.Fatal("filtered Runs request returned no message")
	}

	if len(client.pageOptions) != 1 {
		t.Fatalf("canonical page options calls = %d, want 1", len(client.pageOptions))
	}
	got := client.pageOptions[0]
	if len(got.Status) == 0 || got.Status[0] != "error" {
		t.Fatalf("status round-trip = %#v, want failure statuses", got.Status)
	}
	if got.Since != now.Add(-24*time.Hour).UnixMilli() {
		t.Fatalf("since = %d, want 24h cutoff %d", got.Since, now.Add(-24*time.Hour).UnixMilli())
	}
	if len(got.Session) != 1 || got.Session[0] != "session_docs" {
		t.Fatalf("session round-trip = %#v", got.Session)
	}
	if len(client.inspectOptions) != 1 {
		t.Fatalf("model RunsWithOptions round-trip = %#v", client.inspectOptions)
	}
	inspect := client.inspectOptions[0]
	if len(inspect.Model) != 1 ||
		inspect.Model[0] != "gpt-5" ||
		len(inspect.Status) == 0 ||
		inspect.Since != got.Since ||
		len(inspect.Session) != 1 ||
		inspect.Session[0] != "session_docs" {
		t.Fatalf("RunsWithOptions round-trip = %#v", inspect)
	}
}

func TestRunsSelectedSessionFilterToggles(t *testing.T) {
	runs := NewRuns()
	run := phaseBRun("run-session", "session-selected", "flow.run", "flow", "ok", 100, 10, 0.001)
	setRunsForTest(runs, run)
	selectRunForTest(runs, run.RunID)
	runs.runGroupIndex = 3

	action := runsActionByID(t, runs.Actions(testContext, nil), "runs.session-filter")
	if action.Enabled() {
		t.Fatal("session filter action enabled before session metadata loaded")
	}
	runs.sessions = map[string]bool{"session-selected": true}
	action = runsActionByID(t, runs.Actions(testContext, nil), "runs.session-filter")
	if !action.Enabled() {
		t.Fatalf("session filter action disabled after metadata load: %s", action.DisabledReason)
	}

	runs.toggleSelectedSessionFilter(testContext, nil)
	if runs.sessionFilter != "session-selected" || runs.SelectedRunID() != run.RunID {
		t.Fatalf("selected session filter = %q, selection = %q", runs.sessionFilter, runs.SelectedRunID())
	}
	runs.toggleSelectedSessionFilter(testContext, nil)
	if runs.sessionFilter != "" || runs.SelectedRunID() != run.RunID {
		t.Fatalf("cleared session filter = %q, selection = %q", runs.sessionFilter, runs.SelectedRunID())
	}
}

func TestRunsWideRowsShowCalmUsageAndHealthColumns(t *testing.T) {
	runs := NewRuns()
	runs.Resize(Size{Width: 160, Height: 30})
	row := phaseBRun("run-wide", "session-a", "flow.run", "flow", "ok", 900, 1_250, 0.012)
	row.Model = "openai/gpt-4o-mini"
	row.DeliveryHealth = &observability.RunDeliveryHealth{Status: "degraded"}
	row.SuspendedChildCount = 1
	row.FailedChildCount = 2

	line1, line2 := runs.renderRunRow(row, 44, false)
	wide := stripANSI(line1 + "\n" + line2)
	for _, want := range []string{"gpt-4o-mini", "1.2k tok", "$0.012", "⇣", "⏸1", "!2"} {
		if !strings.Contains(wide, want) {
			t.Fatalf("wide run row omitted %q:\n%s", want, wide)
		}
	}

	row.DeliveryHealth = &observability.RunDeliveryHealth{Status: "healthy"}
	row.SuspendedChildCount = 0
	row.FailedChildCount = 0
	_, calmLine := runs.renderRunRow(row, 44, false)
	if strings.Contains(stripANSI(calmLine), "⇣") || strings.Contains(stripANSI(calmLine), "⏸") || strings.Contains(stripANSI(calmLine), "!") {
		t.Fatalf("calm run row rendered trivial health:\n%s", stripANSI(calmLine))
	}
}

func phaseBRun(
	id, session, primitive, name, status string,
	duration float64,
	tokens int,
	cost float64,
) api.ObservabilityRunSummary {
	metrics, _ := json.Marshal(map[string]any{"totalTokens": tokens, "costUsd": cost})
	return api.ObservabilityRunSummary{
		RunID:         id,
		OperationID:   id,
		SessionID:     session,
		RootPrimitive: primitive,
		Name:          name,
		Status:        status,
		StartedAt:     "2026-07-31T10:00:00Z",
		DurationMs:    duration,
		Metrics:       metrics,
	}
}
