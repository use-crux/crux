package screens

import (
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/store"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

func setOverviewDataForTest(
	o *Overview,
	summary api.InspectOverviewRecord,
	insights []api.InspectInsightRecord,
	runs []api.InspectRunRecord,
	activity []api.InspectActivityEvent,
) {
	applyOverviewSummaryForTest(o, summary)
	applyOverviewInsightsForTest(o, insights)
	applyOverviewRunsForTest(o, runs)
	applyOverviewActivityForTest(o, activity)
}

func applyOverviewSummaryForTest(o *Overview, value api.InspectOverviewRecord) {
	_, token := o.summaryResource.Begin(testContext, overviewSummaryOwner, 0)
	o.summaryResource.Apply(resource.ResourceResult[api.InspectOverviewRecord]{Token: token, Value: value})
}

func applyOverviewStatsForTest(o *Overview, stats store.StatsResult, timeseries []store.TimeseriesBucket) {
	o.stats = &stats
	o.statsTimeseries = append([]store.TimeseriesBucket(nil), timeseries...)
}

func applyOverviewInsightsForTest(o *Overview, value []api.InspectInsightRecord) {
	_, token := o.insightsResource.Begin(testContext, overviewInsightsOwner, 0)
	o.insightsResource.Apply(resource.ResourceResult[[]api.InspectInsightRecord]{Token: token, Value: value})
	o.insightList.SetItems(value)
}

func applyOverviewRunsForTest(o *Overview, value []api.InspectRunRecord) {
	_, token := o.runsResource.Begin(testContext, overviewRunsOwner, 0)
	o.runsResource.Apply(resource.ResourceResult[[]api.InspectRunRecord]{Token: token, Value: value})
	o.runList.SetItems(value)
}

func applyOverviewActivityForTest(o *Overview, value []api.InspectActivityEvent) {
	_, token := o.activityResource.Begin(testContext, overviewActivityOwner, 0)
	o.activityResource.Apply(resource.ResourceResult[[]api.InspectActivityEvent]{Token: token, Value: value})
}
