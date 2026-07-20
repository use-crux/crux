package screens

import (
	"context"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

type insightsContextClient struct {
	DataClient
	listCtx   context.Context
	statusCtx context.Context
}

func (client *insightsContextClient) Insights(ctx context.Context) ([]api.InspectInsightRecord, error) {
	client.listCtx = ctx
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

	screen.Init(root, client)()
	if client.listCtx != root {
		t.Fatal("Insights list fetch did not inherit the Workbench context")
	}

	screen.applyInsights([]api.InspectInsightRecord{{InsightID: "insight-1"}})
	command := screen.Update(root, tea.KeyPressMsg(tea.Key{Text: "x", Code: 'x'}), client)
	if command == nil {
		t.Fatal("dismiss did not return a command")
	}
	command()
	if client.statusCtx != root {
		t.Fatal("Insights status mutation did not inherit the Workbench context")
	}
}
