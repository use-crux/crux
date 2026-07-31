package screens

import (
	"context"
	"encoding/json"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

type insightsListLoadedMsg struct {
	requestID uint64
	value     []api.InspectInsightRecord
	err       string
}

type insightsEvalRunsLoadedMsg struct {
	requestID uint64
	value     []json.RawMessage
	err       string
}

func (s *Insights) fetchData(ctx context.Context, c DataClient) tea.Cmd {
	s.insightsRequest++
	s.evalRunsRequest++
	return tea.Batch(
		fetchInsightsList(ctx, c, s.insightsRequest),
		fetchInsightsEvalRuns(ctx, c, s.evalRunsRequest),
	)
}

func fetchInsightsList(ctx context.Context, c DataClient, requestID uint64) tea.Cmd {
	return func() tea.Msg {
		value, err := c.Insights(ctx)
		message := insightsListLoadedMsg{requestID: requestID, value: value}
		if err != nil {
			message.err = err.Error()
		}
		return message
	}
}

func fetchInsightsEvalRuns(ctx context.Context, c DataClient, requestID uint64) tea.Cmd {
	return func() tea.Msg {
		value, err := c.EvalRuns(ctx)
		message := insightsEvalRunsLoadedMsg{requestID: requestID, value: value}
		if err != nil {
			message.err = err.Error()
		}
		return message
	}
}
