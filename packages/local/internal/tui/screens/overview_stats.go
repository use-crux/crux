package screens

import "github.com/use-crux/crux/packages/local/internal/store"

type overviewStatsProjection struct {
	PassRate       *float64
	CostPer100Runs *float64
	PassRateSeries []float64
	CostSeries     []float64
	LatencySeries  []float64
}

func projectOverviewStats(stats *store.StatsResult, buckets []store.TimeseriesBucket) overviewStatsProjection {
	var projection overviewStatsProjection
	if stats != nil && stats.TotalExecutions > 0 {
		passRate := float64(stats.SuccessCount) / float64(stats.TotalExecutions)
		costPer100Runs := stats.AvgCost * 100
		projection.PassRate = &passRate
		projection.CostPer100Runs = &costPer100Runs
	}
	for _, bucket := range buckets {
		if bucket.Executions <= 0 {
			continue
		}
		projection.PassRateSeries = append(
			projection.PassRateSeries,
			float64(bucket.Executions-bucket.Errors)/float64(bucket.Executions),
		)
		projection.CostSeries = append(
			projection.CostSeries,
			bucket.TotalCost/float64(bucket.Executions)*100,
		)
		if bucket.AvgDurationMs > 0 {
			projection.LatencySeries = append(projection.LatencySeries, bucket.AvgDurationMs)
		}
	}
	return projection
}

func (o *Overview) projectedStats() overviewStatsProjection {
	return projectOverviewStats(o.stats, o.statsTimeseries)
}
