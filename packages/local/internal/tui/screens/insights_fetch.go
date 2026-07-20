package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

type insightsListLoadedMsg []api.InspectInsightRecord

func fetchInsightsList(ctx context.Context, c DataClient) tea.Cmd {
	return func() tea.Msg {
		recs, err := c.Insights(ctx)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return insightsListLoadedMsg(recs)
	}
}
