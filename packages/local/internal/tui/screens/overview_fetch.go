package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

type overviewLoadedMsg struct{ rec api.QualityOverviewRecord }
type insightsLoadedMsg []api.QualityInsightRecord
type runsLoadedMsg []api.QualityRunRecord
type activityLoadedMsg []api.QualityActivityEvent
type dataErrMsg string

func fetchOverview(c DataClient) tea.Cmd {
	return func() tea.Msg {
		rec, err := c.Overview(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return overviewLoadedMsg{rec: rec}
	}
}

func fetchInsights(c DataClient) tea.Cmd {
	return func() tea.Msg {
		rec, err := c.Insights(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return insightsLoadedMsg(rec)
	}
}

func fetchRuns(c DataClient) tea.Cmd {
	return func() tea.Msg {
		rec, err := c.Runs(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return runsLoadedMsg(rec)
	}
}

func fetchActivity(c DataClient, limit int) tea.Cmd {
	return func() tea.Msg {
		rec, err := c.Activity(context.Background(), limit)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return activityLoadedMsg(rec)
	}
}
