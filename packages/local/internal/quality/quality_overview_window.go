package quality

import (
	"time"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
)

const (
	qualityOverviewWindowAll = "all"
	overviewSparkBuckets     = 12
)

type qualityOverviewWindow struct {
	Name     string
	Now      time.Time
	Since    time.Time
	Duration time.Duration
	Bounded  bool
}

func newQualityOverviewWindow(raw string, now time.Time) qualityOverviewWindow {
	now = now.UTC()
	switch raw {
	case "24h":
		return qualityOverviewWindow{Name: raw, Now: now, Since: now.Add(-24 * time.Hour), Duration: 24 * time.Hour, Bounded: true}
	case "7d":
		duration := 7 * 24 * time.Hour
		return qualityOverviewWindow{Name: raw, Now: now, Since: now.Add(-duration), Duration: duration, Bounded: true}
	case "30d":
		duration := 30 * 24 * time.Hour
		return qualityOverviewWindow{Name: raw, Now: now, Since: now.Add(-duration), Duration: duration, Bounded: true}
	default:
		return qualityOverviewWindow{Name: qualityOverviewWindowAll, Now: now}
	}
}

func filterSpecExperimentsForOverviewWindow(records []qualityfs.ExperimentRecordFile, window qualityOverviewWindow) []qualityfs.ExperimentRecordFile {
	if !window.Bounded {
		return records
	}
	out := make([]qualityfs.ExperimentRecordFile, 0, len(records))
	for _, file := range records {
		at, ok := specExperimentRecordTime(file.Record)
		if ok && overviewWindowContains(window, at) {
			out = append(out, file)
		}
	}
	return out
}

func filterBaselinesForOverviewWindow(records []qualityfs.BaselineRecordFile, window qualityOverviewWindow) []qualityfs.BaselineRecordFile {
	if !window.Bounded {
		return records
	}
	out := make([]qualityfs.BaselineRecordFile, 0, len(records))
	for _, file := range records {
		at, ok := parseQualityTime(file.Record.PromotedAt)
		if ok && overviewWindowContains(window, at) {
			out = append(out, file)
		}
	}
	return out
}

func filterCassettesForOverviewWindow(records []qualityfs.CassetteFileInfo, window qualityOverviewWindow) []qualityfs.CassetteFileInfo {
	if !window.Bounded {
		return records
	}
	out := make([]qualityfs.CassetteFileInfo, 0, len(records))
	for _, record := range records {
		at, ok := parseQualityTime(record.RecordedAt)
		if ok && overviewWindowContains(window, at) {
			out = append(out, record)
		}
	}
	return out
}

func filterFeedbackForOverviewWindow(records []qualityFeedbackRecord, window qualityOverviewWindow) []qualityFeedbackRecord {
	if !window.Bounded {
		return records
	}
	out := make([]qualityFeedbackRecord, 0, len(records))
	for _, record := range records {
		at, ok := parseQualityTime(record.CreatedAt)
		if ok && overviewWindowContains(window, at) {
			out = append(out, record)
		}
	}
	return out
}

func filterRunsForOverviewWindow(records []qualityRunRecord, window qualityOverviewWindow) []qualityRunRecord {
	if !window.Bounded {
		return records
	}
	out := make([]qualityRunRecord, 0, len(records))
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

func overviewWindowContains(window qualityOverviewWindow, at time.Time) bool {
	if !window.Bounded {
		return true
	}
	at = at.UTC()
	return !at.Before(window.Since) && !at.After(window.Now)
}

func specExperimentRecordTime(record qualityfs.ExperimentRecord) (time.Time, bool) {
	return parseQualityTime(nonEmptyString(record.EndedAt, record.StartedAt))
}

func specPassRateHistoryForOverviewWindow(records []qualityfs.ExperimentRecordFile, window qualityOverviewWindow) []float64 {
	if !window.Bounded {
		return specPassRateHistory(records, window.Now)
	}
	const buckets = 14
	out := make([]float64, buckets)
	step := window.Duration / buckets
	if step <= 0 {
		step = time.Nanosecond
	}
	last := 0.0
	for i := 0; i < buckets; i++ {
		start := window.Since.Add(time.Duration(i) * step)
		end := start.Add(step)
		if i == buckets-1 {
			end = window.Now
		}
		passed := 0
		total := 0
		for _, file := range records {
			at, ok := specExperimentRecordTime(file.Record)
			if !ok || !timeInBucket(at, start, end, i == buckets-1) {
				continue
			}
			filePassed, fileTotal := specCellTally(file.Record)
			passed += filePassed
			total += fileTotal
		}
		if total > 0 {
			last = float64(passed) / float64(total)
		}
		out[i] = last
	}
	return out
}

func qualityOverviewPassRateSpark(runs []qualityRunRecord, window qualityOverviewWindow) []float64 {
	out := make([]float64, overviewSparkBuckets)
	forEachOverviewRunBucket(runs, window, func(index int, bucket []qualityRunRecord) {
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

func qualityOverviewCostSpark(runs []qualityRunRecord, window qualityOverviewWindow) []float64 {
	out := make([]float64, overviewSparkBuckets)
	forEachOverviewRunBucket(runs, window, func(index int, bucket []qualityRunRecord) {
		if len(bucket) > 0 {
			out[index] = (qualityTotalCost(bucket) / float64(len(bucket))) * 100
		}
	})
	forwardFillFloat(out)
	return out
}

func qualityOverviewLatencySpark(runs []qualityRunRecord, window qualityOverviewWindow) []float64 {
	out := make([]float64, overviewSparkBuckets)
	forEachOverviewRunBucket(runs, window, func(index int, bucket []qualityRunRecord) {
		if p95 := qualityP95Latency(bucket); p95 != nil {
			out[index] = *p95
		}
	})
	forwardFillFloat(out)
	return out
}

func forEachOverviewRunBucket(runs []qualityRunRecord, window qualityOverviewWindow, fn func(index int, bucket []qualityRunRecord)) {
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
	buckets := make([][]qualityRunRecord, overviewSparkBuckets)
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

func overviewRunBucketBounds(runs []qualityRunRecord, window qualityOverviewWindow) (time.Time, time.Time) {
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
