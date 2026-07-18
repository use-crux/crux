package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

type overviewLoadedMsg struct{ rec api.InspectOverviewRecord }
type insightsLoadedMsg []api.InspectInsightRecord
type runsLoadedMsg []api.InspectRunRecord
type activityLoadedMsg []api.InspectActivityEvent
type dataErrMsg string

func fetchOverview(ctx context.Context, c DataClient) tea.Cmd {
	return func() tea.Msg {
		rec, err := c.Overview(ctx)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return overviewLoadedMsg{rec: rec}
	}
}

func fetchInsights(ctx context.Context, c DataClient) tea.Cmd {
	return func() tea.Msg {
		rec, err := c.Insights(ctx)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return insightsLoadedMsg(rec)
	}
}

func fetchRuns(ctx context.Context, c DataClient) tea.Cmd {
	return func() tea.Msg {
		rec, err := c.Runs(ctx)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return runsLoadedMsg(rec)
	}
}

func fetchActivity(ctx context.Context, c DataClient, limit int) tea.Cmd {
	return func() tea.Msg {
		rec, err := c.Activity(ctx, limit)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return activityLoadedMsg(rec)
	}
}
