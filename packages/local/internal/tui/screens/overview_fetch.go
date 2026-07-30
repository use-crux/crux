package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

type overviewLoadedMsg resource.ResourceResult[api.InspectOverviewRecord]
type insightsLoadedMsg resource.ResourceResult[[]api.InspectInsightRecord]
type activityLoadedMsg resource.ResourceResult[[]api.InspectActivityEvent]

type runsLoadedMsg struct {
	Result resource.ResourceResult[[]api.InspectRunRecord]
	Names  map[string]string
}

func (m overviewLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[api.InspectOverviewRecord](m).Token.Owner
}

func (m insightsLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[[]api.InspectInsightRecord](m).Token.Owner
}

func (m runsLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return m.Result.Token.Owner
}

func (m activityLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[[]api.InspectActivityEvent](m).Token.Owner
}

// dataErrMsg remains the temporary shared error envelope for screens that have
// not yet migrated to owned resources.
type dataErrMsg string

var (
	overviewSummaryOwner  = resource.ResourceOwner{Screen: "overview", Resource: "summary"}
	overviewInsightsOwner = resource.ResourceOwner{Screen: "overview", Resource: "insights"}
	overviewRunsOwner     = resource.ResourceOwner{Screen: "overview", Resource: "runs"}
	overviewActivityOwner = resource.ResourceOwner{Screen: "overview", Resource: "activity"}
)

func (o *Overview) fetchSummary(parent context.Context, client DataClient) tea.Cmd {
	return o.fetchSummaryAtRevision(parent, client, 0)
}

func (o *Overview) fetchSummaryAtRevision(parent context.Context, client DataClient, revision uint64) tea.Cmd {
	snapshot := o.summaryResource.Snapshot()
	ctx, token := o.summaryResource.Begin(parent, overviewSummaryOwner, maxRevisionFloor(snapshot.Token.Revision, revision))
	return func() tea.Msg {
		value, err := client.Overview(ctx)
		return overviewLoadedMsg(resource.ResourceResult[api.InspectOverviewRecord]{Token: token, Value: value, Err: err})
	}
}

func (o *Overview) fetchInsights(parent context.Context, client DataClient) tea.Cmd {
	return o.fetchInsightsAtRevision(parent, client, 0)
}

func (o *Overview) fetchInsightsAtRevision(parent context.Context, client DataClient, revision uint64) tea.Cmd {
	snapshot := o.insightsResource.Snapshot()
	ctx, token := o.insightsResource.Begin(parent, overviewInsightsOwner, maxRevisionFloor(snapshot.Token.Revision, revision))
	return func() tea.Msg {
		value, err := client.Insights(ctx)
		return insightsLoadedMsg(resource.ResourceResult[[]api.InspectInsightRecord]{Token: token, Value: value, Err: err})
	}
}

func (o *Overview) fetchRuns(parent context.Context, client DataClient) tea.Cmd {
	return o.fetchRunsAtRevision(parent, client, 0)
}

func (o *Overview) fetchRunsAtRevision(parent context.Context, client DataClient, revision uint64) tea.Cmd {
	snapshot := o.runsResource.Snapshot()
	ctx, token := o.runsResource.Begin(parent, overviewRunsOwner, maxRevisionFloor(snapshot.Token.Revision, revision))
	return func() tea.Msg {
		value, err := client.Runs(ctx)
		names := map[string]string{}
		if err == nil {
			page, pageErr := client.ObservabilityRunsPage(ctx)
			if pageErr == nil {
				for _, run := range page.Rows {
					if run.RunID != "" && run.Name != "" {
						names[run.RunID] = run.Name
					}
				}
			}
		}
		return runsLoadedMsg{
			Result: resource.ResourceResult[[]api.InspectRunRecord]{Token: token, Value: value, Err: err},
			Names:  names,
		}
	}
}

func (o *Overview) fetchActivity(parent context.Context, client DataClient, limit int) tea.Cmd {
	return o.fetchActivityAtRevision(parent, client, limit, 0)
}

func (o *Overview) fetchActivityAtRevision(parent context.Context, client DataClient, limit int, revision uint64) tea.Cmd {
	snapshot := o.activityResource.Snapshot()
	ctx, token := o.activityResource.Begin(parent, overviewActivityOwner, maxRevisionFloor(snapshot.Token.Revision, revision))
	return func() tea.Msg {
		value, err := client.Activity(ctx, limit)
		return activityLoadedMsg(resource.ResourceResult[[]api.InspectActivityEvent]{Token: token, Value: value, Err: err})
	}
}
