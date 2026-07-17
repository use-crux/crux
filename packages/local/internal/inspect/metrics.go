package inspect

import (
	"sort"
	"time"
)

func inspectMeanRunScore(runs []inspectRunRecord) *float64 {
	total := 0.0
	count := 0
	for _, run := range runs {
		if run.Score == nil {
			continue
		}
		total += *run.Score
		count++
	}
	if count == 0 {
		return nil
	}
	value := total / float64(count)
	return &value
}

func inspectTotalCost(runs []inspectRunRecord) float64 {
	total := 0.0
	for _, run := range runs {
		if run.Cost != nil {
			total += *run.Cost
		}
	}
	return total
}

func inspectP50Latency(runs []inspectRunRecord) *float64 {
	values := []float64{}
	for _, run := range runs {
		if run.DurationMs != nil {
			values = append(values, *run.DurationMs)
		}
	}
	if len(values) == 0 {
		return nil
	}
	sort.Float64s(values)
	value := values[(len(values)-1)/2]
	return &value
}

func inspectP95Latency(runs []inspectRunRecord) *float64 {
	values := []float64{}
	for _, run := range runs {
		if run.DurationMs != nil {
			values = append(values, *run.DurationMs)
		}
	}
	return percentile(values, 0.95)
}

func percentile(values []float64, p float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	sort.Float64s(values)
	index := int(float64(len(values)-1) * p)
	value := values[index]
	return &value
}

func fixedFloatSeries(length int, value float64) []float64 {
	out := make([]float64, length)
	for i := range out {
		out[i] = value
	}
	return out
}

func fixedIntSeries(length int, value int) []int {
	out := make([]int, length)
	for i := range out {
		out[i] = value
	}
	return out
}

func inspectOpenInsightsHistory(insights []inspectInsightRecord) []int {
	open := 0
	for _, insight := range insights {
		if insight.Status == "" || insight.Status == "open" {
			open++
		}
	}
	return fixedIntSeries(12, open)
}

func inspectInsightOccurrenceTrend(insight inspectInsightRecord, runs []inspectRunRecord) []float64 {
	return inspectInsightOccurrenceTrendAt(insight, runs, time.Now())
}

func inspectInsightOccurrenceTrendAt(insight inspectInsightRecord, runs []inspectRunRecord, now time.Time) []float64 {
	if len(insight.LinkedTraceIDs) == 0 {
		return fixedFloatSeries(12, float64(insight.OccurrenceCount))
	}
	out := make([]float64, 12)
	forEachRunHourBucketAt(runs, now, func(index int, bucket []inspectRunRecord) {
		out[index] = float64(len(bucket))
	})
	if sumFloatSeries(out) == 0 && len(runs) > 0 {
		return inspectRelativeOccurrenceTrend(runs, 12)
	}
	return out
}

func inspectRelativeOccurrenceTrend(runs []inspectRunRecord, length int) []float64 {
	out := make([]float64, length)
	if length <= 0 || len(runs) == 0 {
		return out
	}
	if len(runs) == 1 {
		out[length-1] = 1
		return out
	}
	minStarted := runs[0].StartedAt
	maxStarted := runs[0].StartedAt
	for _, run := range runs[1:] {
		if run.StartedAt < minStarted {
			minStarted = run.StartedAt
		}
		if run.StartedAt > maxStarted {
			maxStarted = run.StartedAt
		}
	}
	if maxStarted <= minStarted {
		out[length-1] = float64(len(runs))
		return out
	}
	span := float64(maxStarted - minStarted)
	for _, run := range runs {
		index := int((float64(run.StartedAt-minStarted) / span) * float64(length-1))
		if index < 0 {
			index = 0
		}
		if index >= length {
			index = length - 1
		}
		out[index]++
	}
	return out
}

func sumFloatSeries(series []float64) float64 {
	total := 0.0
	for _, value := range series {
		total += value
	}
	return total
}
