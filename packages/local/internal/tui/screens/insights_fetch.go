package screens

import (
	"context"
	"encoding/json"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

var insightsListOwner = resource.ResourceOwner{Screen: "insights", Resource: "list"}
var insightsEvalRunsOwner = resource.ResourceOwner{Screen: "insights", Resource: "eval-runs"}

type insightsListLoadedMsg resource.ResourceResult[[]api.InspectInsightRecord]
type insightsEvalRunsLoadedMsg resource.ResourceResult[[]json.RawMessage]

func (m insightsListLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[[]api.InspectInsightRecord](m).Token.Owner
}

func (m insightsEvalRunsLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[[]json.RawMessage](m).Token.Owner
}

func (s *Insights) fetchData(ctx context.Context, c DataClient) tea.Cmd {
	return tea.Batch(
		s.fetchInsightsList(ctx, c, 0),
		s.fetchInsightsEvalRuns(ctx, c, 0),
	)
}

func (s *Insights) fetchInsightsList(parent context.Context, c DataClient, revision uint64) tea.Cmd {
	snapshot := s.insightsResource.Snapshot()
	ctx, token := s.insightsResource.Begin(parent, insightsListOwner, maxRevisionFloor(snapshot.Token.Revision, revision))
	return func() tea.Msg {
		value, err := c.Insights(ctx)
		return insightsListLoadedMsg(resource.ResourceResult[[]api.InspectInsightRecord]{
			Token: token, Value: value, Err: err,
		})
	}
}

func (s *Insights) fetchInsightsEvalRuns(parent context.Context, c DataClient, revision uint64) tea.Cmd {
	snapshot := s.evalRunsResource.Snapshot()
	ctx, token := s.evalRunsResource.Begin(parent, insightsEvalRunsOwner, maxRevisionFloor(snapshot.Token.Revision, revision))
	return func() tea.Msg {
		value, err := c.EvalRuns(ctx)
		return insightsEvalRunsLoadedMsg(resource.ResourceResult[[]json.RawMessage]{
			Token: token, Value: value, Err: err,
		})
	}
}
