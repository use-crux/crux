package inspect

import "time"

const (
	inspectOverviewWindowAll = "all"
	overviewSparkBuckets     = 12
)

type inspectOverviewWindow struct {
	Name     string
	Now      time.Time
	Since    time.Time
	Duration time.Duration
	Bounded  bool
}

func newInspectOverviewWindow(raw string, now time.Time) inspectOverviewWindow {
	now = now.UTC()
	switch raw {
	case "24h":
		return inspectOverviewWindow{Name: raw, Now: now, Since: now.Add(-24 * time.Hour), Duration: 24 * time.Hour, Bounded: true}
	case "7d":
		duration := 7 * 24 * time.Hour
		return inspectOverviewWindow{Name: raw, Now: now, Since: now.Add(-duration), Duration: duration, Bounded: true}
	case "30d":
		duration := 30 * 24 * time.Hour
		return inspectOverviewWindow{Name: raw, Now: now, Since: now.Add(-duration), Duration: duration, Bounded: true}
	default:
		return inspectOverviewWindow{Name: inspectOverviewWindowAll, Now: now}
	}
}

func filterRunsForOverviewWindow(records []inspectRunRecord, window inspectOverviewWindow) []inspectRunRecord {
	if !window.Bounded {
		return records
	}
	out := make([]inspectRunRecord, 0, len(records))
	for _, record := range records {
		if record.StartedAt == 0 {
			continue
		}
		at := time.UnixMilli(record.StartedAt).UTC()
		if overviewWindowContains(window, at) {
			out = append(out, record)
		}
	}
	return out
}

func overviewWindowContains(window inspectOverviewWindow, at time.Time) bool {
	if !window.Bounded {
		return true
	}
	at = at.UTC()
	return !at.Before(window.Since) && !at.After(window.Now)
}

func inspectOverviewPassRateSpark(runs []inspectRunRecord, window inspectOverviewWindow) []float64 {
	out := make([]float64, overviewSparkBuckets)
	forEachOverviewRunBucket(runs, window, func(index int, bucket []inspectRunRecord) {
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

func inspectOverviewCostSpark(runs []inspectRunRecord, window inspectOverviewWindow) []float64 {
	out := make([]float64, overviewSparkBuckets)
	forEachOverviewRunBucket(runs, window, func(index int, bucket []inspectRunRecord) {
		if len(bucket) > 0 {
			out[index] = (inspectTotalCost(bucket) / float64(len(bucket))) * 100
		}
	})
	forwardFillFloat(out)
	return out
}

func inspectOverviewLatencySpark(runs []inspectRunRecord, window inspectOverviewWindow) []float64 {
	out := make([]float64, overviewSparkBuckets)
	forEachOverviewRunBucket(runs, window, func(index int, bucket []inspectRunRecord) {
		if p95 := inspectP95Latency(bucket); p95 != nil {
			out[index] = *p95
		}
	})
	forwardFillFloat(out)
	return out
}

func forEachOverviewRunBucket(runs []inspectRunRecord, window inspectOverviewWindow, fn func(index int, bucket []inspectRunRecord)) {
	start, end := overviewRunBucketBounds(runs, window)
	span := end.Sub(start)
	if span <= 0 {
		span = time.Duration(overviewSparkBuckets) * time.Hour
		start = end.Add(-span)
	}
	step := span / overviewSparkBuckets
	if step <= 0 {
		step = time.Nanosecond
	}
	buckets := make([][]inspectRunRecord, overviewSparkBuckets)
	for _, run := range runs {
		if run.StartedAt == 0 {
			continue
		}
		at := time.UnixMilli(run.StartedAt).UTC()
		if at.Before(start) || at.After(end) {
			continue
		}
		index := int(at.Sub(start) / step)
		if index < 0 {
			index = 0
		}
		if index >= len(buckets) {
			index = len(buckets) - 1
		}
		buckets[index] = append(buckets[index], run)
	}
	for index, bucket := range buckets {
		fn(index, bucket)
	}
}

func overviewRunBucketBounds(runs []inspectRunRecord, window inspectOverviewWindow) (time.Time, time.Time) {
	if window.Bounded {
		return window.Since, window.Now
	}
	var start time.Time
	var end time.Time
	for _, run := range runs {
		if run.StartedAt == 0 {
			continue
		}
		at := time.UnixMilli(run.StartedAt).UTC()
		if start.IsZero() || at.Before(start) {
			start = at
		}
		if end.IsZero() || at.After(end) {
			end = at
		}
	}
	if start.IsZero() || end.IsZero() {
		end = window.Now
		start = end.Add(-time.Duration(overviewSparkBuckets) * time.Hour)
	}
	return start, end
}

func timeInBucket(at time.Time, start time.Time, end time.Time, includeEnd bool) bool {
	at = at.UTC()
	if at.Before(start) {
		return false
	}
	if includeEnd {
		return !at.After(end)
	}
	return at.Before(end)
}
