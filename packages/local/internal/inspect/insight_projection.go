package inspect

import (
	"time"
)

func enrichInspectInsightFromRuns(insight inspectInsightRecord, runs []inspectRunRecord, now time.Time) inspectInsightRecord {
	insight.OccurrenceCount = len(insight.LinkedTraceIDs)
	if insight.OccurrenceCount == 0 {
		insight.OccurrenceCount = len(insight.LinkedCaseIDs)
	}
	runs = filterInspectInsightRuns(insight, runs)
	insight.Trend = inspectInsightOccurrenceTrendAt(insight, runs, now)
	tokens := 0.0
	for _, run := range runs {
		tokens += float64(run.TokenCount)
	}
	if len(runs) > 0 {
		tokens = tokens / float64(len(runs))
	}
	latency := 0.0
	if p95 := inspectP95Latency(runs); p95 != nil {
		latency = *p95
	}
	cost := 0.0
	if len(runs) > 0 {
		cost = (inspectTotalCost(runs) / float64(len(runs))) * 100
	}
	tokenSpark := inspectHourlyTokenSparkAt(runs, now)
	latencySpark := inspectHourlyLatencySparkAt(runs, now)
	costSpark := inspectHourlyCostSparkAt(runs, now)
	insight.DetailStats = &inspectInsightDetailStats{
		TokensPerRun:           tokens,
		TokensSpark:            tokenSpark,
		TokensDeltaVsBaseline:  inspectDeltaLabel(tokenSpark),
		LatencyP95Ms:           latency,
		LatencySpark:           latencySpark,
		LatencyDeltaVsBaseline: inspectDeltaLabel(latencySpark),
		CostPer100:             cost,
		CostSpark:              costSpark,
		CostDeltaVsBaseline:    inspectDeltaLabel(costSpark),
	}
	return insight
}

func inspectDiagnosticSeverity(codes []string) string {
	for _, code := range codes {
		switch code {
		case "stale-boundary", "missing-span-end", "operation-deadline-exceeded", "convex-boundary-lease-expired":
			return "high"
		}
	}
	return "medium"
}

func inspectLatencySeverity(durationMs float64) string {
	if durationMs >= 180000 {
		return "high"
	}
	return "medium"
}

func inspectTokenSeverity(tokens int) string {
	if tokens >= 25000 {
		return "high"
	}
	return "medium"
}

func inspectCostSeverity(cost float64) string {
	if cost >= 0.25 {
		return "high"
	}
	return "medium"
}

func inspectSignalSeverity(blocked int) string {
	if blocked > 0 {
		return "high"
	}
	return "medium"
}

func filterInspectInsightRuns(insight inspectInsightRecord, runs []inspectRunRecord) []inspectRunRecord {
	if len(insight.LinkedTraceIDs) == 0 {
		return runs
	}
	filtered := make([]inspectRunRecord, 0, len(runs))
	for _, run := range runs {
		if containsString(insight.LinkedTraceIDs, inspectRunIdentity(run)) {
			filtered = append(filtered, run)
		}
	}
	return filtered
}

func applyInspectInsightStatus(insight *inspectInsightRecord, status inspectInsightStatusRecord, now time.Time) {
	insight.ResolvedAt = status.ResolvedAt
	insight.ResolvedOccurrences = status.ResolvedOccurrences
	if status.Status == "resolved" && status.ResolvedOccurrences > 0 && insight.OccurrenceCount > status.ResolvedOccurrences {
		reopenedAt := now.UTC().Format(time.RFC3339Nano)
		insight.Status = "open"
		insight.ReopenedAt = reopenedAt
		insight.PreviousResolutionAt = status.ResolvedAt
		insight.UpdatedAt = reopenedAt
		return
	}
	insight.Status = status.Status
	insight.UpdatedAt = status.UpdatedAt
}

func filterSilencedInspectInsights(insights []inspectInsightRecord, silences []inspectInsightSilenceRecord) []inspectInsightRecord {
	if len(silences) == 0 {
		return insights
	}
	filtered := make([]inspectInsightRecord, 0, len(insights))
	for _, insight := range insights {
		if inspectInsightIsSilenced(insight, silences) {
			continue
		}
		filtered = append(filtered, insight)
	}
	return filtered
}

func activeInspectInsightSilences(silences []inspectInsightSilenceRecord) []inspectInsightSilenceRecord {
	active := make([]inspectInsightSilenceRecord, 0, len(silences))
	for _, silence := range silences {
		if silence.DeletedAt == "" {
			active = append(active, silence)
		}
	}
	return active
}

func inspectInsightIsSilenced(insight inspectInsightRecord, silences []inspectInsightSilenceRecord) bool {
	for _, silence := range silences {
		if silence.DeletedAt != "" || silence.Pattern.Title == "" || silence.Pattern.Title != insight.Title {
			continue
		}
		if silence.Pattern.TargetID == "" || silence.Pattern.TargetID == insight.TargetID {
			return true
		}
	}
	return false
}
