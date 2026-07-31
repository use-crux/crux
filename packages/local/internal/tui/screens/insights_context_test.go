package screens

import (
	"context"
	"encoding/json"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

type insightsContextClient struct {
	DataClient
	listCtx   context.Context
	evalCtx   context.Context
	statusCtx context.Context
}

func (client *insightsContextClient) Insights(ctx context.Context) ([]api.InspectInsightRecord, error) {
	client.listCtx = ctx
	return nil, nil
}

func (client *insightsContextClient) EvalRuns(ctx context.Context) ([]json.RawMessage, error) {
	client.evalCtx = ctx
	return nil, nil
}

func (client *insightsContextClient) SetInsightStatus(ctx context.Context, _ string, _ api.InspectInsightStatusRequest) (api.InspectInsightStatusRecord, error) {
	client.statusCtx = ctx
	return api.InspectInsightStatusRecord{}, nil
}

func TestInsightsCommandsInheritWorkbenchContext(t *testing.T) {
	type contextKey struct{}
	root := context.WithValue(context.Background(), contextKey{}, "root")
	client := &insightsContextClient{}
	screen := NewInsights()

	applyInsightsTestCommand(t, root, screen, screen.Init(root, client), client)
	if client.listCtx == nil || client.listCtx.Value(contextKey{}) != "root" {
		t.Fatal("Insights list fetch did not inherit the Workbench context")
	}
	if client.evalCtx == nil || client.evalCtx.Value(contextKey{}) != "root" {
		t.Fatal("Insights Eval runs fetch did not inherit the Workbench context")
	}

	screen.applyInsights([]api.InspectInsightRecord{{InsightID: "insight-1"}})
	command := screen.Update(root, tea.KeyPressMsg(tea.Key{Text: "d", Code: 'd'}), client)
	if command == nil {
		t.Fatal("dismiss did not return a command")
	}
	command()
	if client.statusCtx != root {
		t.Fatal("Insights status mutation did not inherit the Workbench context")
	}
}

func applyInsightsTestCommand(
	t *testing.T,
	ctx context.Context,
	screen *Insights,
	command tea.Cmd,
	client DataClient,
) {
	t.Helper()
	if command == nil {
		return
	}
	message := command()
	if batch, ok := message.(tea.BatchMsg); ok {
		for _, child := range batch {
			applyInsightsTestCommand(t, ctx, screen, child, client)
		}
		return
	}
	applyInsightsTestCommand(t, ctx, screen, screen.Update(ctx, message, client), client)
}
