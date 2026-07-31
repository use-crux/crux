package screens

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestEvalGridProjectionPreservesMixedStatuses(t *testing.T) {
	run, ok := projectEvalRun(evalTestJSON(map[string]any{
		"runId": "mixed", "evalId": "quality",
		"selection": map[string]any{
			"cases": []string{"a", "b"}, "variants": []string{"current", "candidate"},
		},
		"cells": []any{
			map[string]any{"caseId": "a", "variant": "current", "status": "passed"},
			map[string]any{"caseId": "a", "variant": "candidate", "status": "failed"},
			map[string]any{"caseId": "b", "variant": "current", "status": "skipped"},
		},
	}))
	if !ok {
		t.Fatal("mixed Eval run did not project")
	}
	got := []string{
		normalizeEvalCellStatus(run.cell(0, 0).Status),
		normalizeEvalCellStatus(run.cell(0, 1).Status),
		normalizeEvalCellStatus(run.cell(1, 0).Status),
		normalizeEvalCellStatus(run.cell(1, 1).Status),
	}
	want := []string{"pass", "fail", "skipped", "not-run"}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("cell statuses = %#v, want %#v", got, want)
		}
	}
}

func TestEvalGridRepresentativeTrialPrefersFailureAndExactRun(t *testing.T) {
	runRaw := evalTestJSON(map[string]any{
		"runId": "multi-trial", "evalId": "quality",
		"selection": map[string]any{
			"cases": []string{"refund"}, "variants": []string{"current"},
		},
		"cells": []any{
			map[string]any{
				"caseId": "refund", "variant": "current", "trial": 0, "status": "passed",
				"runIds": []string{"pass-run"},
			},
			map[string]any{
				"caseId": "refund", "variant": "current", "trial": 1, "status": "failed",
				"runIds": []string{"failed-run"},
			},
		},
	})
	run, ok := projectEvalRun(runRaw)
	if !ok {
		t.Fatal("multi-trial Eval run did not project")
	}
	representative := run.cell(0, 0)
	if representative.Trial != 1 || normalizeEvalCellStatus(representative.Status) != "fail" ||
		len(representative.RunIDs) != 1 || representative.RunIDs[0] != "failed-run" {
		t.Fatalf("representative trial = %#v, want failed trial 1", representative)
	}

	screen := NewEvals()
	catalogRaw := []json.RawMessage{evalTestJSON(map[string]any{"id": "quality"})}
	_, catalogToken := screen.catalogResource.Begin(testContext, evalCatalogResourceOwner, 0)
	screen.catalogResource.Apply(resource.ResourceResult[[]json.RawMessage]{
		Token: catalogToken, Value: catalogRaw,
	})
	screen.items = projectEvalCatalog(catalogRaw)
	screen.catalog.SetItems(screen.items)
	screen.runs = []evalRunItem{run}
	screen.run = run
	screen.selectedRunID = run.RunID
	_, runToken := screen.runResource.Begin(testContext, evalRunOwner(run.RunID), 0)
	screen.runResource.Apply(resource.ResourceResult[json.RawMessage]{
		Token: runToken, Value: runRaw,
	})
	_, token := screen.localRunResource.Begin(testContext, evalLocalRunOwner("failed-run"), 0)
	screen.localRunResource.Apply(resource.ResourceResult[evalRunAvailability]{
		Token: token, Value: evalRunAvailability{Checked: true, Available: true},
	})
	screen.setFocus(evalsFocusGrid)
	screen.Resize(Size{Width: 100, Height: 30})
	screen.syncDetail(false)

	view := stripANSI(screen.View(Size{}))
	for _, want := range []string{"■ fail", "refund × current · trial 1", "failed-run · Enter to open"} {
		if !strings.Contains(view, want) {
			t.Fatalf("multi-trial detail omitted %q:\n%s", want, view)
		}
	}
	message := evalAction(screen, nil, "evals.activate").Run()()
	if request, ok := message.(NavigateRequest); !ok ||
		request != (NavigateRequest{NavID: "runs", Kind: "run", ID: "failed-run"}) {
		t.Fatalf("representative Enter emitted %#v, want failed-run", message)
	}
}

func TestEvalCatalogArmStatusUsesCurrentAndFingerprint(t *testing.T) {
	screen := NewEvals()
	item := evalCatalogItem{ID: "quality", DefinitionFingerprint: "definition-v2"}
	run := evalRunItem{
		EvalID: "quality", DefinitionFingerprint: "definition-v2",
		Variants: []string{"candidate", "current"},
		Aggregates: map[string]evalAggregate{
			"candidate": {Cells: 1, Failed: 1},
			"current":   {Cells: 1, Passed: 1},
		},
	}
	screen.runs = []evalRunItem{run}
	if label, _ := screen.catalogArmStatus(item); label != "■ passed" {
		t.Fatalf("current arm status = %q, want passed despite failed candidate", label)
	}
	run.Aggregates["current"] = evalAggregate{Cells: 1, Failed: 1}
	screen.runs = []evalRunItem{run}
	if label, _ := screen.catalogArmStatus(item); label != "■ failed" {
		t.Fatalf("current arm status = %q, want failed", label)
	}
	run.DefinitionFingerprint = "definition-v1"
	screen.runs = []evalRunItem{run}
	if label, _ := screen.catalogArmStatus(item); label != "◇ stale" {
		t.Fatalf("fingerprint mismatch status = %q, want stale", label)
	}
	screen.runs = nil
	if label, _ := screen.catalogArmStatus(item); label != "◌ not-run" {
		t.Fatalf("missing run status = %q, want not-run", label)
	}
}

func TestEvalsCellNavigationAndRunLinkGating(t *testing.T) {
	client := uitest.NewFixtureClient()
	screen := loadedFixtureEvals(t, client)
	screen.Resize(Size{Width: 100, Height: 30})

	applyEvalsCommand(t, screen, screen.Update(testContext, keyPress("tab"), client), client)
	if screen.focus != evalsFocusGrid {
		t.Fatal("Tab did not focus the grid")
	}
	applyEvalsCommand(t, screen, screen.Update(testContext, keyPress("l"), client), client)
	if screen.cellRow != 0 || screen.cellColumn != 1 {
		t.Fatalf("cell after l = (%d,%d), want (0,1)", screen.cellRow, screen.cellColumn)
	}
	if action := evalAction(screen, client, "evals.activate"); action.Enabled() {
		t.Fatal("absent observed run enabled Enter")
	}
	view := stripANSI(screen.View(Size{}))
	if !strings.Contains(view, "not recorded locally") {
		t.Fatalf("absent observed run did not render honest state:\n%s", view)
	}

	applyEvalsCommand(t, screen, screen.Update(testContext, keyPress("h"), client), client)
	applyEvalsCommand(t, screen, screen.Update(testContext, keyPress("j"), client), client)
	if screen.cellRow != 1 || screen.cellColumn != 0 {
		t.Fatalf("cell after h,j = (%d,%d), want reused local cell (1,0)", screen.cellRow, screen.cellColumn)
	}
	activate := evalAction(screen, client, "evals.activate")
	if !activate.Enabled() {
		t.Fatalf("local observed run disabled Enter: %s", activate.DisabledReason)
	}
	message := activate.Run()()
	request, ok := message.(NavigateRequest)
	if !ok || request != (NavigateRequest{NavID: "runs", Kind: "run", ID: "8af2f1c"}) {
		t.Fatalf("Enter emitted %#v, want exact local Runs route", message)
	}

	_, token := screen.localRunResource.Begin(
		testContext, evalLocalRunOwner("8af2f1c"), 0,
	)
	if action := evalAction(screen, client, "evals.activate"); action.Enabled() {
		t.Fatal("refreshing availability retained a stale enabled Enter action")
	}
	screen.localRunResource.Apply(resource.ResourceResult[evalRunAvailability]{
		Token: token,
		Err:   errors.New("availability unavailable"),
	})
	action := evalAction(screen, client, "evals.activate")
	if action.Enabled() || action.DisabledReason != "availability check failed" {
		t.Fatalf("degraded availability action = %#v, want failed and disabled", action)
	}
}

func TestEvalsBaselineCompatibilityAndReuseRendering(t *testing.T) {
	client := uitest.NewFixtureClient()
	screen := loadedFixtureEvals(t, client)
	screen.Resize(Size{Width: 160, Height: 45})
	screen.setFocus(evalsFocusGrid)
	screen.cellRow, screen.cellColumn = 1, 0
	applyEvalsCommand(t, screen, screen.fetchSelectedLocalRun(testContext, client), client)
	screen.syncDetail(false)
	view := stripANSI(screen.View(Size{}))
	for _, want := range []string{
		"exact_evidence", "duration", "cost", "BASELINE", "current",
		"fraud-lock", "incompatible · expected_changed",
	} {
		if !strings.Contains(view, want) {
			t.Fatalf("Eval detail omitted %q:\n%s", want, view)
		}
	}
}

type evalsCountingClient struct {
	*uitest.FixtureClient
	catalogCalls  int
	runsCalls     int
	runCalls      int
	baselineCalls int
	localRunCalls int
}

func (client *evalsCountingClient) EvalCatalog(ctx context.Context) ([]json.RawMessage, error) {
	client.catalogCalls++
	return client.FixtureClient.EvalCatalog(ctx)
}

func (client *evalsCountingClient) EvalRuns(ctx context.Context) ([]json.RawMessage, error) {
	client.runsCalls++
	return client.FixtureClient.EvalRuns(ctx)
}

func (client *evalsCountingClient) EvalRun(ctx context.Context, id string) (json.RawMessage, error) {
	client.runCalls++
	return client.FixtureClient.EvalRun(ctx, id)
}

func (client *evalsCountingClient) EvalBaselines(ctx context.Context) ([]json.RawMessage, error) {
	client.baselineCalls++
	return client.FixtureClient.EvalBaselines(ctx)
}

func (client *evalsCountingClient) ObservabilityRunDetail(
	ctx context.Context,
	id string,
) (api.ObservabilityRunDetail, bool, error) {
	client.localRunCalls++
	return client.FixtureClient.ObservabilityRunDetail(ctx, id)
}

func TestEvalsRefreshUsesOnlyNamedResources(t *testing.T) {
	client := &evalsCountingClient{FixtureClient: uitest.NewFixtureClient()}
	screen := loadedFixtureEvals(t, client)
	before := []int{client.catalogCalls, client.runsCalls, client.runCalls, client.baselineCalls}

	if command := screen.Refresh(testContext, client, bridge.Invalidations{bridge.IndexSnapshotResource: 9}); command != nil {
		t.Fatal("unrelated Index invalidation scheduled Eval reads")
	}
	applyEvalsCommand(t, screen, screen.Refresh(testContext, client, bridge.Invalidations{
		bridge.EvalsCatalogResource:   2,
		bridge.EvalsRunsResource:      2,
		bridge.EvalsAnyRunResource:    2,
		bridge.EvalsBaselinesResource: 2,
	}), client)
	after := []int{client.catalogCalls, client.runsCalls, client.runCalls, client.baselineCalls}
	for index := range before {
		if after[index] != before[index]+1 {
			t.Fatalf("calls after named refresh = %#v, before %#v", after, before)
		}
	}
}

func TestEvalsDeactivateMarksEveryVisibleReadStaleForOneReactivation(t *testing.T) {
	client := &evalsCountingClient{FixtureClient: uitest.NewFixtureClient()}
	screen := loadedFixtureEvals(t, client)
	before := []int{
		client.catalogCalls, client.runsCalls, client.runCalls,
		client.baselineCalls, client.localRunCalls,
	}

	invalidations := screen.Deactivate()
	for _, name := range []bridge.ResourceName{
		bridge.EvalsCatalogResource,
		bridge.EvalsRunsResource,
		bridge.EvalsRunResource(screen.selectedRunID),
		bridge.EvalsBaselinesResource,
		bridge.EvalsLocalRunResource(screen.selectedObservedRunID()),
	} {
		if _, ok := invalidations.Revision(name); !ok {
			t.Fatalf("Deactivate omitted stale-on-focus invalidation %s", name)
		}
	}
	applyEvalsCommand(t, screen, screen.Refresh(testContext, client, invalidations), client)
	after := []int{
		client.catalogCalls, client.runsCalls, client.runCalls,
		client.baselineCalls, client.localRunCalls,
	}
	for index := range before {
		if after[index] != before[index]+1 {
			t.Fatalf("calls after one reactivation = %#v, before %#v", after, before)
		}
	}
	if command := screen.Refresh(testContext, client, nil); command != nil {
		t.Fatal("second focus without invalidation scheduled another refresh")
	}
}

func loadedFixtureEvals(t *testing.T, client DataClient) *Evals {
	t.Helper()
	screen := NewEvals()
	if fixture, ok := client.(*uitest.FixtureClient); ok {
		screen.now = func() time.Time { return fixture.Now }
	}
	if wrapped, ok := client.(*evalsCountingClient); ok {
		screen.now = func() time.Time { return wrapped.Now }
	}
	applyEvalsCommand(t, screen, screen.Init(testContext, client), client)
	return screen
}

func applyEvalsCommand(t *testing.T, screen *Evals, command tea.Cmd, client DataClient) {
	t.Helper()
	if command == nil {
		return
	}
	message := command()
	if batch, ok := message.(tea.BatchMsg); ok {
		for _, child := range batch {
			applyEvalsCommand(t, screen, child, client)
		}
		return
	}
	if message != nil {
		applyEvalsCommand(t, screen, screen.Update(testContext, message, client), client)
	}
}

func keyPress(value string) tea.KeyPressMsg {
	if value == "tab" {
		return tea.KeyPressMsg{Code: tea.KeyTab}
	}
	return tea.KeyPressMsg{Text: value, Code: rune(value[0])}
}

func evalAction(screen *Evals, client DataClient, id string) interaction.Action {
	for _, action := range screen.Actions(testContext, client) {
		if action.ID == id {
			return action
		}
	}
	return interaction.Action{}
}

func evalTestJSON(value any) json.RawMessage {
	raw, _ := json.Marshal(value)
	return raw
}
