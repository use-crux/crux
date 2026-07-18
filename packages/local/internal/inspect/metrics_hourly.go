package inspect

import (
	"fmt"
	"sort"
	"time"
)

func inspectHourlyTokenSpark(runs []inspectRunRecord) []float64 {
	return inspectHourlyTokenSparkAt(runs, time.Now())
}

func inspectHourlyTokenSparkAt(runs []inspectRunRecord, now time.Time) []float64 {
	out := make([]float64, 12)
	forEachRunHourBucketAt(runs, now, func(index int, bucket []inspectRunRecord) {
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

func inspectHourlyPassRateSpark(runs []inspectRunRecord) []float64 {
	out := make([]float64, 12)
	forEachRunHourBucket(runs, func(index int, bucket []inspectRunRecord) {
		passed := 0
		for _, run := range bucket {
			if isPassingRunStatus(run.Status) {
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

func isPassingRunStatus(status string) bool {
	switch status {
	case "ok", "success", "passed":
		return true
	default:
		return false
	}
}

func inspectHourlyCostSpark(runs []inspectRunRecord) []float64 {
	return inspectHourlyCostSparkAt(runs, time.Now())
}

func inspectHourlyCostSparkAt(runs []inspectRunRecord, now time.Time) []float64 {
	out := make([]float64, 12)
	forEachRunHourBucketAt(runs, now, func(index int, bucket []inspectRunRecord) {
		if len(bucket) > 0 {
			out[index] = (inspectTotalCost(bucket) / float64(len(bucket))) * 100
		}
	})
	forwardFillFloat(out)
	return out
}

func inspectHourlyLatencySpark(runs []inspectRunRecord) []float64 {
	return inspectHourlyLatencySparkAt(runs, time.Now())
}

func inspectHourlyLatencySparkAt(runs []inspectRunRecord, now time.Time) []float64 {
	out := make([]float64, 12)
	forEachRunHourBucketAt(runs, now, func(index int, bucket []inspectRunRecord) {
		if p95 := inspectP95Latency(bucket); p95 != nil {
			out[index] = *p95
		}
	})
	forwardFillFloat(out)
	return out
}

func inspectDeltaLabel(series []float64) string {
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

func forEachRunHourBucket(runs []inspectRunRecord, fn func(index int, bucket []inspectRunRecord)) {
	forEachRunHourBucketAt(runs, time.Now(), fn)
}

func forEachRunHourBucketAt(runs []inspectRunRecord, now time.Time, fn func(index int, bucket []inspectRunRecord)) {
	now = now.UTC().Truncate(time.Hour)
	buckets := make([][]inspectRunRecord, 12)
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

func inspectMillisToRFC3339(value int64) string {
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

func parseInspectTime(value string) (time.Time, bool) {
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

func inspectRecentRuns(runs []inspectRunRecord, limit int) []inspectRunRecord {
	ordered := append([]inspectRunRecord{}, runs...)
	sort.SliceStable(ordered, func(i int, j int) bool {
		return ordered[i].StartedAt > ordered[j].StartedAt
	})
	if len(ordered) > limit {
		return ordered[:limit]

	}
	return ordered
}
