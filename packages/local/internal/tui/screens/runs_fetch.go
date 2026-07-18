package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

// --- fetch -------------------------------------------------------------------

type runsListLoadedMsg []api.InspectRunRecord
type runDetailLoadedMsg api.InspectRunDetailRecord

func fetchRunsList(ctx context.Context, c DataClient) tea.Cmd {
	return func() tea.Msg {
		observabilityRuns, err := c.ObservabilityRuns(ctx)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return runsListLoadedMsg(inspectRunsFromObservability(observabilityRuns))
	}
}

func fetchRunDetail(ctx context.Context, c DataClient, traceID string) tea.Cmd {
	return func() tea.Msg {
		detail, found, detailErr := c.ObservabilityRunDetail(ctx, traceID)
		if detailErr != nil {
			return dataErrMsg(detailErr.Error())
		}
		if !found {
			return dataErrMsg("run not found")
		}
		return runDetailLoadedMsg(inspectRunDetailFromObservabilityDetail(detail))
	}
}
