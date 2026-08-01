package screens

import (
	"context"
	"fmt"
	"math/rand"
	"reflect"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
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

type gateRunsClient struct {
	*uitest.FixtureClient
	rows []api.ObservabilityRunSummary
}

func (client *gateRunsClient) ObservabilityRunsPage(
	_ context.Context,
	_ ...string,
) (api.ObservabilityRunsPage, error) {
	return api.ObservabilityRunsPage{Revision: 1, Rows: append([]api.ObservabilityRunSummary(nil), client.rows...)}, nil
}

func (client *gateRunsClient) ObservabilityRunsPageWithOptions(
	_ context.Context,
	options api.InspectRunsOptions,
	_ ...string,
) (api.ObservabilityRunsPage, error) {
	return api.ObservabilityRunsPage{Revision: 1, Rows: client.filtered(options)}, nil
}

func (client *gateRunsClient) RunsWithOptions(
	_ context.Context,
	options api.InspectRunsOptions,
) ([]api.InspectRunRecord, error) {
	rows := client.filtered(options)
	result := make([]api.InspectRunRecord, len(rows))
	for index, row := range rows {
		result[index] = api.InspectRunRecord{
			OperationID: row.RunID, TraceID: row.TraceID, SessionID: row.SessionID,
			TargetID: row.Name, Status: row.Status, Model: row.Model,
			StartedAt: parseObservabilityTime(row.StartedAt),
		}
	}
	return result, nil
}

func (client *gateRunsClient) filtered(options api.InspectRunsOptions) []api.ObservabilityRunSummary {
	result := make([]api.ObservabilityRunSummary, 0, len(client.rows))
	for _, row := range client.rows {
		if len(options.Status) > 0 && !runStatusMatches(row.Status, options.Status) {
			continue
		}
		if len(options.Session) > 0 && row.SessionID != options.Session[0] {
			continue
		}
		if len(options.Model) > 0 && !strings.EqualFold(row.Model, options.Model[0]) {
			continue
		}
		if options.Since > 0 && parseObservabilityTime(row.StartedAt) < options.Since {
			continue
		}
		result = append(result, row)
	}
	if options.Limit > 0 && len(result) > options.Limit {
		result = result[:options.Limit]
	}
	return result
}

func newGateRunsClient(now time.Time) *gateRunsClient {
	rows := make([]api.ObservabilityRunSummary, 100)
	for index := range rows {
		name := fmt.Sprintf("Scale run %d", index)
		if index == 8 {
			name += " 200-span"
		}
		rows[index] = api.ObservabilityRunSummary{
			RunID: fmt.Sprintf("run-%03d", index), OperationID: fmt.Sprintf("run-%03d", index),
			TraceID: fmt.Sprintf("trace-%03d", index), Name: name, Status: "ok", Model: "gpt-a",
			SessionID: fmt.Sprintf("session_scale_%02d", index%2),
			StartedAt: now.Add(-time.Duration(index) * time.Minute).Format(time.RFC3339Nano),
		}
	}
	return &gateRunsClient{FixtureClient: uitest.NewFixtureClient(), rows: rows}
}

func applyRunsCommand(t *testing.T, runs *Runs, client DataClient, command tea.Cmd) {
	t.Helper()
	if command == nil {
		return
	}
	message := command()
	if batch, ok := message.(tea.BatchMsg); ok {
		for _, child := range batch {
			applyRunsCommand(t, runs, client, child)
		}
		return
	}
	if _, detailIntent := message.(runDetailIntentMsg); detailIntent {
		return
	}
	if message != nil {
		applyRunsCommand(t, runs, client, runs.Update(testContext, message, client))
	}
}

func TestRunsExactNEW002FullResetRebuildsAuthoritativeRows(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	previousNow := runsListNow
	runsListNow = func() time.Time { return now }
	t.Cleanup(func() { runsListNow = previousNow })
	client := newGateRunsClient(now)
	runs := NewRuns()
	setRunsForTest(runs, client.rows...)
	runs.sessions = map[string]bool{"session_scale_00": true, "session_scale_01": true}

	// Gate script: /200-span, group by session, select-session, clear text,
	// then return session/group to defaults and round-trip Overview → Runs.
	for _, key := range []string{"/", "2", "0", "0", "-", "s", "p", "a", "n", "enter", "G", "G", "G", "s", "/"} {
		applyRunsCommand(t, runs, client, runs.Update(testContext, keyPress(key), client))
	}
	applyRunsCommand(t, runs, client, runs.Update(testContext, tea.KeyPressMsg{Code: 'x', Mod: tea.ModCtrl}, client))
	applyRunsCommand(t, runs, client, runs.Update(testContext, keyPress("enter"), client))
	applyRunsCommand(t, runs, client, runs.Update(testContext, keyPress("s"), client))
	applyRunsCommand(t, runs, client, runs.Update(testContext, keyPress("G"), client))
	runs.runList.SetItems(nil)
	applyRunsCommand(t, runs, client, runs.Refresh(testContext, client, nil))

	if got := len(runs.filteredRuns()); got != 100 || runs.runList.Position().Total != 100 {
		t.Fatalf("NEW-002 reset rows = %d pane = %d, want authoritative 100", got, runs.runList.Position().Total)
	}
	if projection := runs.projectRunsFilters(now); projection.summary.Session != "" || projection.summary.Group != "none" ||
		len(projection.request.Session) != 0 {
		t.Fatalf("NEW-002 reset retained stale request/display state: %#v %#v", projection.summary, projection.request)
	}
}

func TestRunsExactRandom3SessionFilterNavigationKeepsAuthoritativeRows(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	previousNow := runsListNow
	runsListNow = func() time.Time { return now }
	t.Cleanup(func() { runsListNow = previousNow })
	client := newGateRunsClient(now)
	runs := NewRuns()
	setRunsForTest(runs, client.rows...)
	runs.sessions = map[string]bool{"session_scale_00": true, "session_scale_01": true}
	for range 3 {
		applyRunsCommand(t, runs, client, runs.Update(testContext, keyPress("G"), client))
	}
	runs.sessions = map[string]bool{"session_scale_00": true, "session_scale_01": true}
	for range 8 {
		applyRunsCommand(t, runs, client, runs.Update(testContext, keyPress("j"), client))
	}
	applyRunsCommand(t, runs, client, runs.Update(testContext, keyPress("s"), client))
	runs.runList.SetItems(nil)
	applyRunsCommand(t, runs, client, runs.Refresh(testContext, client, nil))
	if got := len(runs.filteredRuns()); got != 50 || runs.runList.Position().Total != 50 {
		t.Fatalf("random3 session rows = %d pane = %d, want authoritative 50", got, runs.runList.Position().Total)
	}
}

func TestRunsReloadRejectsStaleFilterResultAndRebuildsCurrentState(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	previousNow := runsListNow
	runsListNow = func() time.Time { return now }
	t.Cleanup(func() { runsListNow = previousNow })
	client := newGateRunsClient(now)
	runs := NewRuns()
	runs.filters.Session = "session_scale_00"
	stale := runs.fetchRunsList(testContext, client)
	runs.filters.Session = ""
	if command := runs.Update(testContext, stale(), client); command != nil || runs.runsResource.Snapshot().HasValue {
		t.Fatal("stale filtered response replaced authoritative current state")
	}
	reload := runsActionByID(t, runs.Actions(testContext, client), "runs.reload").Run()
	if snapshot := runs.runsResource.Snapshot(); snapshot.State != resource.ResourceLoading || snapshot.HasValue {
		t.Fatalf("reload retained a local derivation while fetching: %#v", snapshot)
	}
	applyRunsCommand(t, runs, client, reload)
	if got := len(runs.filteredRuns()); got != 100 {
		t.Fatalf("reload rows = %d, want authoritative 100", got)
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
			runs.filters.Query = []string{"", "trace 00", "missing"}[random.Intn(3)]
		case 1:
			runs.filters.Status = random.Intn(len(runStatusFilters))
		case 2:
			runs.filters.Window = random.Intn(len(runWindows))
		case 3:
			runs.filters.Group = random.Intn(len(runGroups))
		case 4:
			runs.filters.Session = []string{"", "session-a", "session-b"}[random.Intn(3)]
		case 5:
			runs.filters.Model = []string{"", "gpt-a", "gpt-b"}[random.Intn(3)]
		case 6:
			// Navigation discards only transient pane rows. The resource and
			// filters remain authoritative when the screen regains focus.
			runs.runList.SetItems(nil)
			runs.Refresh(testContext, nil, nil)
		}
		assertRunsFilterContract(t, runs, fixedNow, step)
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

func assertRunsFilterContract(t *testing.T, runs *Runs, now time.Time, step int) {
	t.Helper()
	projection := runs.projectRunsFilters(now)
	if projection.summary.Query != runs.filters.Query || projection.summary.Group != runs.activeRunGroup().label ||
		projection.summary.Status != runs.activeRunStatusFilter().label || projection.summary.Window != runs.activeRunWindow().label ||
		projection.summary.Session != runs.filters.Session || projection.summary.Model != runs.filters.Model ||
		projection.summary.Definition != runs.filters.Definition {
		t.Fatalf("step %d: displayed summary diverged from filter state: %#v vs %#v", step, projection.summary, runs.filters)
	}
	want := api.InspectRunsOptions{Status: append([]string(nil), runs.activeRunStatusFilter().statuses...), Limit: 100}
	if window := runs.activeRunWindow(); window.duration > 0 {
		want.Since = now.Add(-window.duration).UnixMilli()
	}
	if runs.filters.Session != "" {
		want.Session = []string{runs.filters.Session}
	}
	if runs.filters.Model != "" {
		want.Model = []string{runs.filters.Model}
	}
	if !reflect.DeepEqual(projection.request, want) {
		t.Fatalf("step %d: request params diverged from displayed state: %#v vs %#v", step, projection.request, want)
	}
	if owner := runsListOwnerForDefinition(projection.summary.Definition); owner != runsListOwnerForDefinition(runs.filters.Definition) {
		t.Fatalf("step %d: request owner diverged from displayed definition: %#v", step, owner)
	}
}
