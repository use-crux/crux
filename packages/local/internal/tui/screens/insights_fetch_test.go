package screens

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

type insightsIndependentFetchClient struct {
	DataClient
	insightCalls int
	evalCalls    int
}

func (client *insightsIndependentFetchClient) Insights(context.Context) ([]api.InspectInsightRecord, error) {
	client.insightCalls++
	return []api.InspectInsightRecord{{InsightID: "visible", Title: "Visible insight"}}, nil
}

func (client *insightsIndependentFetchClient) EvalRuns(context.Context) ([]json.RawMessage, error) {
	client.evalCalls++
	return nil, nil
}

func TestInsightsPrimaryListCanCompleteBeforeEvalRuns(t *testing.T) {
	client := &insightsIndependentFetchClient{}
	screen := NewInsights()
	batch, ok := screen.Init(testContext, client)().(tea.BatchMsg)
	if !ok || len(batch) != 2 {
		t.Fatalf("Insights Init = %#v, want two independent commands", batch)
	}

	message := batch[0]()
	if client.insightCalls != 1 || client.evalCalls != 0 {
		t.Fatalf("executing list command called insights=%d evals=%d", client.insightCalls, client.evalCalls)
	}
	screen.Update(testContext, message, client)
	if !screen.loaded || len(screen.items) != 1 {
		t.Fatalf("primary list did not become visible independently: loaded=%v items=%d", screen.loaded, len(screen.items))
	}
}

func TestInsightsEvalErrorRecoversOnNewerSuccess(t *testing.T) {
	screen := NewInsights()
	screen.fetchInsightsEvalRuns(testContext, &insightsIndependentFetchClient{}, 0)
	first := screen.evalRunsResource.Snapshot().Token
	screen.Update(testContext, insightsEvalRunsLoadedMsg(resource.ResourceResult[[]json.RawMessage]{
		Token: first, Err: errors.New("eval unavailable"),
	}), nil)
	if screen.evalEvidenceErr == "" {
		t.Fatal("Eval error was not retained")
	}

	screen.fetchInsightsEvalRuns(testContext, &insightsIndependentFetchClient{}, 0)
	second := screen.evalRunsResource.Snapshot().Token
	screen.Update(testContext, insightsEvalRunsLoadedMsg(resource.ResourceResult[[]json.RawMessage]{
		Token: second,
		Value: []json.RawMessage{insightEvalRunJSON("recovered", 200, []any{
			insightEvalCellJSON("case-a", "current", 0, "passed", "passed", ""),
		})},
	}), nil)
	if screen.evalEvidenceErr != "" || len(screen.evalRuns) != 1 || screen.evalRuns[0].RunID != "recovered" {
		t.Fatalf("Eval success did not recover state: err=%q runs=%#v", screen.evalEvidenceErr, screen.evalRuns)
	}
}

func TestInsightsIgnoresOutOfOrderReadCompletions(t *testing.T) {
	screen := NewInsights()
	client := &insightsIndependentFetchClient{}
	screen.fetchInsightsList(testContext, client, 0)
	staleList := screen.insightsResource.Snapshot().Token
	screen.fetchInsightsList(testContext, client, 0)
	newList := screen.insightsResource.Snapshot().Token

	screen.Update(testContext, insightsListLoadedMsg(resource.ResourceResult[[]api.InspectInsightRecord]{
		Token: newList, Value: []api.InspectInsightRecord{{InsightID: "new"}},
	}), client)
	screen.Update(testContext, insightsListLoadedMsg(resource.ResourceResult[[]api.InspectInsightRecord]{
		Token: staleList, Value: []api.InspectInsightRecord{{InsightID: "stale"}},
	}), client)
	if len(screen.items) != 1 || screen.items[0].InsightID != "new" {
		t.Fatalf("stale Insights completion won: %#v", screen.items)
	}

	newRun := insightEvalRunJSON("new-run", 200, []any{
		insightEvalCellJSON("case-a", "current", 0, "passed", "passed", ""),
	})
	staleRun := insightEvalRunJSON("stale-run", 100, []any{
		insightEvalCellJSON("case-a", "current", 0, "failed", "failed", ""),
	})
	screen.fetchInsightsEvalRuns(testContext, client, 0)
	staleEval := screen.evalRunsResource.Snapshot().Token
	screen.fetchInsightsEvalRuns(testContext, client, 0)
	newEval := screen.evalRunsResource.Snapshot().Token
	screen.Update(testContext, insightsEvalRunsLoadedMsg(resource.ResourceResult[[]json.RawMessage]{
		Token: newEval, Value: []json.RawMessage{newRun},
	}), client)
	screen.Update(testContext, insightsEvalRunsLoadedMsg(resource.ResourceResult[[]json.RawMessage]{
		Token: staleEval, Value: []json.RawMessage{staleRun},
	}), client)
	if len(screen.evalRuns) != 1 || screen.evalRuns[0].RunID != "new-run" {
		t.Fatalf("stale Eval completion won: %#v", screen.evalRuns)
	}
}
