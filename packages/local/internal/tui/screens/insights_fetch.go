package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

type insightsListLoadedMsg []api.InspectInsightRecord

func fetchInsightsList(c DataClient) tea.Cmd {
	return func() tea.Msg {
		recs, err := c.Insights(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return insightsListLoadedMsg(recs)
	}
}
