package quality

import (
	"time"
)

func enrichQualityInsightFromRuns(insight qualityInsightRecord, runs []qualityRunRecord, now time.Time) qualityInsightRecord {
	insight.OccurrenceCount = len(insight.LinkedTraceIDs)
	if insight.OccurrenceCount == 0 {
		insight.OccurrenceCount = len(insight.LinkedCaseIDs) + len(insight.LinkedExperimentIDs) + len(insight.LinkedCassettePaths)
	}
	runs = filterQualityInsightRuns(insight, runs)
	insight.Trend = qualityInsightOccurrenceTrendAt(insight, runs, now)
	tokens := 0.0
	for _, run := range runs {
		tokens += float64(run.TokenCount)
	}
	if len(runs) > 0 {
		tokens = tokens / float64(len(runs))
	}
	latency := 0.0
	if p95 := qualityP95Latency(runs); p95 != nil {
		latency = *p95
	}
	cost := 0.0
	if len(runs) > 0 {
		cost = (qualityTotalCost(runs) / float64(len(runs))) * 100
	}
	tokenSpark := qualityHourlyTokenSparkAt(runs, now)
	latencySpark := qualityHourlyLatencySparkAt(runs, now)
	costSpark := qualityHourlyCostSparkAt(runs, now)
	insight.DetailStats = &qualityInsightDetailStats{
		TokensPerRun:           tokens,
		TokensSpark:            tokenSpark,
		TokensDeltaVsBaseline:  qualityDeltaLabel(tokenSpark),
		LatencyP95Ms:           latency,
		LatencySpark:           latencySpark,
		LatencyDeltaVsBaseline: qualityDeltaLabel(latencySpark),
		CostPer100:             cost,
		CostSpark:              costSpark,
		CostDeltaVsBaseline:    qualityDeltaLabel(costSpark),
	}
	return insight
}

func qualityDiagnosticSeverity(codes []string) string {
	for _, code := range codes {
		switch code {
		case "stale-boundary", "missing-span-end", "operation-deadline-exceeded", "convex-boundary-lease-expired":
			return "high"
		}
	}
	return "medium"
}

func qualityLatencySeverity(durationMs float64) string {
	if durationMs >= 180000 {
		return "high"
	}
	return "medium"
}

func qualityTokenSeverity(tokens int) string {
	if tokens >= 25000 {
		return "high"
	}
	return "medium"
}

func qualityCostSeverity(cost float64) string {
	if cost >= 0.25 {
		return "high"
	}
	return "medium"
}

func qualitySignalSeverity(blocked int) string {
	if blocked > 0 {
		return "high"
	}
	return "medium"
}

func filterQualityInsightRuns(insight qualityInsightRecord, runs []qualityRunRecord) []qualityRunRecord {
	if len(insight.LinkedTraceIDs) == 0 {
		return runs
	}
	filtered := make([]qualityRunRecord, 0, len(runs))
	for _, run := range runs {
		if containsString(insight.LinkedTraceIDs, run.TraceID) {
			filtered = append(filtered, run)
		}
	}
	return filtered
}

func applyQualityInsightStatus(insight *qualityInsightRecord, status qualityInsightStatusRecord, now time.Time) {
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

func filterSilencedQualityInsights(insights []qualityInsightRecord, silences []qualityInsightSilenceRecord) []qualityInsightRecord {
	if len(silences) == 0 {
		return insights
	}
	filtered := make([]qualityInsightRecord, 0, len(insights))
	for _, insight := range insights {
		if qualityInsightIsSilenced(insight, silences) {
			continue
		}
		filtered = append(filtered, insight)
	}
	return filtered
}

func activeQualityInsightSilences(silences []qualityInsightSilenceRecord) []qualityInsightSilenceRecord {
	active := make([]qualityInsightSilenceRecord, 0, len(silences))
	for _, silence := range silences {
		if silence.DeletedAt == "" {
			active = append(active, silence)
		}
	}
	return active
}

func qualityInsightIsSilenced(insight qualityInsightRecord, silences []qualityInsightSilenceRecord) bool {
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
