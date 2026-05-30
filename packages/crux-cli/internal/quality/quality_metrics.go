package quality

import (
	"fmt"
	"sort"
	"time"
)

type qualityRunScoreSummary struct {
	Name  string
	Value *float64
}

func qualityScoresByTrace(dir string) (map[string]qualityRunScoreSummary, error) {
	experiments, err := readQualityExperimentRecords(dir)
	if err != nil {
		return nil, err
	}
	byTrace := map[string]qualityRunScoreSummary{}
	for _, experiment := range experiments {
		for _, testCase := range experiment.Cases {
			if testCase.TraceID == "" {
				continue
			}
			for _, score := range testCase.Scores {
				if score.Kind != "numeric" || score.Value == nil {
					continue
				}
				value := *score.Value
				byTrace[testCase.TraceID] = qualityRunScoreSummary{
					Name:  score.Name,
					Value: &value,
				}
				break
			}
		}
	}
	return byTrace, nil
}

func qualityPassRate(experiments []qualityExperimentRecord) *float64 {
	total := 0
	passed := 0
	for _, experiment := range experiments {
		total += experiment.Summary.Total
		passed += experiment.Summary.Passed
	}
	if total == 0 {
		return nil
	}
	value := float64(passed) / float64(total)
	return &value
}

func qualityMeanRunScore(runs []qualityRunRecord) *float64 {
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

func qualityTotalCost(runs []qualityRunRecord) float64 {
	total := 0.0
	for _, run := range runs {
		if run.Cost != nil {
			total += *run.Cost
		}
	}
	return total
}

func qualityP50Latency(runs []qualityRunRecord) *float64 {
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

func qualityP95Latency(runs []qualityRunRecord) *float64 {
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

func qualityPassRateHistory(experiments []qualityExperimentRecord) []float64 {
	return bucketExperimentPassRates(experiments, 14, 24*time.Hour)
}

func bucketExperimentPassRates(experiments []qualityExperimentRecord, count int, step time.Duration) []float64 {
	return bucketExperimentPassRatesAt(experiments, count, step, time.Now())
}

func bucketExperimentPassRatesAt(experiments []qualityExperimentRecord, count int, step time.Duration, now time.Time) []float64 {
	out := make([]float64, count)
	now = now.UTC().Truncate(step)
	last := 0.0
	for i := 0; i < count; i++ {
		start := now.Add(time.Duration(i-count+1) * step)
		end := start.Add(step)
		total := 0
		passed := 0
		for _, experiment := range experiments {
			at, ok := parseQualityTime(nonEmptyString(experiment.EndedAt, experiment.StartedAt))
			if !ok || at.Before(start) || !at.Before(end) {
				continue
			}
			total += experiment.Summary.Total
			passed += experiment.Summary.Passed
		}
		if total > 0 {
			last = float64(passed) / float64(total)
		}
		out[i] = last
	}
	return out
}

func qualityOpenInsightsHistory(insights []qualityInsightRecord) []int {
	open := 0
	for _, insight := range insights {
		if insight.Status == "" || insight.Status == "open" {
			open++
		}
	}
	return fixedIntSeries(12, open)
}

func qualityInsightOccurrenceTrend(insight qualityInsightRecord, runs []qualityRunRecord) []float64 {
	if len(insight.LinkedTraceIDs) == 0 {
		return fixedFloatSeries(12, float64(insight.OccurrenceCount))
	}
	out := make([]float64, 12)
	forEachRunHourBucket(runs, func(index int, bucket []qualityRunRecord) {
		out[index] = float64(len(bucket))
	})
	if sumFloatSeries(out) == 0 && len(runs) > 0 {
		return qualityRelativeOccurrenceTrend(runs, 12)
	}
	return out
}

func qualityRelativeOccurrenceTrend(runs []qualityRunRecord, length int) []float64 {
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

func qualityHourlyTokenSpark(runs []qualityRunRecord) []float64 {
	out := make([]float64, 12)
	forEachRunHourBucket(runs, func(index int, bucket []qualityRunRecord) {
		if len(bucket) == 0 {
			return
		}
		total := 0
		for _, run := range bucket {
			total += run.TokenCount
		}
		out[index] = float64(total) / float64(len(bucket))
	})
	forwardFillFloat(out)
	return out
}

func qualityHourlyPassRateSpark(runs []qualityRunRecord) []float64 {
	out := make([]float64, 12)
	forEachRunHourBucket(runs, func(index int, bucket []qualityRunRecord) {
		passed := 0
		for _, run := range bucket {
			if run.Status == "success" || run.Status == "passed" {
				passed++
			}
		}
		if len(bucket) > 0 {
			out[index] = float64(passed) / float64(len(bucket))
		}
	})
	forwardFillFloat(out)
	return out
}

func qualityHourlyCostSpark(runs []qualityRunRecord) []float64 {
	out := make([]float64, 12)
	forEachRunHourBucket(runs, func(index int, bucket []qualityRunRecord) {
		if len(bucket) > 0 {
			out[index] = (qualityTotalCost(bucket) / float64(len(bucket))) * 100
		}
	})
	forwardFillFloat(out)
	return out
}

func qualityHourlyLatencySpark(runs []qualityRunRecord) []float64 {
	out := make([]float64, 12)
	forEachRunHourBucket(runs, func(index int, bucket []qualityRunRecord) {
		if p95 := qualityP95Latency(bucket); p95 != nil {
			out[index] = *p95
		}
	})
	forwardFillFloat(out)
	return out
}

func qualityDeltaLabel(series []float64) string {
	if len(series) < 2 {
		return "n/a"
	}
	nonZero := make([]float64, 0, len(series))
	for _, value := range series {
		if value != 0 {
			nonZero = append(nonZero, value)
		}
	}
	if len(nonZero) < 2 {
		return "n/a"
	}
	mid := len(nonZero) / 2
	baseline := averageValues(nonZero[:mid])
	recent := averageValues(nonZero[mid:])
	if baseline == nil || recent == nil {
		return "n/a"
	}
	if *baseline == 0 {
		if *recent == 0 {
			return "0%"
		}
		return "+100%"
	}
	delta := ((*recent - *baseline) / *baseline) * 100
	return fmt.Sprintf("%+.0f%%", delta)
}

func averageValues(values []float64) *float64 {
	total := 0.0
	for _, value := range values {
		total += value
	}
	if len(values) == 0 {
		return nil
	}
	avg := total / float64(len(values))
	return &avg
}

func forEachRunHourBucket(runs []qualityRunRecord, fn func(index int, bucket []qualityRunRecord)) {
	forEachRunHourBucketAt(runs, time.Now(), fn)
}

func forEachRunHourBucketAt(runs []qualityRunRecord, now time.Time, fn func(index int, bucket []qualityRunRecord)) {
	now = now.UTC().Truncate(time.Hour)
	buckets := make([][]qualityRunRecord, 12)
	for _, run := range runs {
		at := time.UnixMilli(run.StartedAt).UTC().Truncate(time.Hour)
		index := int(at.Sub(now.Add(-11*time.Hour)) / time.Hour)
		if index < 0 || index >= len(buckets) {
			continue
		}
		buckets[index] = append(buckets[index], run)
	}
	for index, bucket := range buckets {
		fn(index, bucket)
	}
}

func qualityMillisToRFC3339(value int64) string {
	if value == 0 {
		return ""
	}
	return time.UnixMilli(value).UTC().Format(time.RFC3339Nano)
}

func forwardFillFloat(values []float64) {
	last := 0.0
	for index, value := range values {
		if value == 0 {
			values[index] = last
			continue
		}
		last = value
	}
}

func parseQualityTime(value string) (time.Time, bool) {
	if value == "" {
		return time.Time{}, false
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed.UTC(), true
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed.UTC(), true
	}
	return time.Time{}, false
}

func qualityRecentRuns(runs []qualityRunRecord, limit int) []qualityRunRecord {
	ordered := append([]qualityRunRecord{}, runs...)
	sort.SliceStable(ordered, func(i int, j int) bool {
		return ordered[i].StartedAt > ordered[j].StartedAt
	})
	if len(ordered) > limit {
		return ordered[:limit]

	}
	return ordered
}
