package store

import "math"

// CompositionStatsResult holds aggregated composition analytics.
type CompositionStatsResult struct {
	ByKind map[string]CompositionKindStatsResult `json:"byKind"`
	Swarm  *SwarmAnalyticsResult                 `json:"swarm"`
}

// CompositionKindStatsResult holds per-kind composition metrics.
type CompositionKindStatsResult struct {
	Total         int     `json:"total"`
	Success       int     `json:"success"`
	Error         int     `json:"error"`
	AvgDurationMs float64 `json:"avgDurationMs"`
	AvgAgents     float64 `json:"avgAgents"`
}

// SwarmAnalyticsResult holds swarm-specific aggregate metrics.
type SwarmAnalyticsResult struct {
	AvgHandoffs     float64          `json:"avgHandoffs"`
	TopPaths        []PathCount      `json:"topPaths"`
	AgentBottleneck *AgentBottleneck `json:"agentBottleneck"`
}

// PathCount tracks a handoff path and its frequency.
type PathCount struct {
	Path  string `json:"path"`
	Count int    `json:"count"`
}

// AgentBottleneck identifies the slowest agent.
type AgentBottleneck struct {
	AgentID       string  `json:"agentId"`
	AvgDurationMs float64 `json:"avgDurationMs"`
}

// GetSessions returns all sessions with trace counts and time ranges,
// sorted by most recent activity first.
func (s *Store) GetSessions() []SessionInfo {
	return []SessionInfo{}
}

// GetTimeseries distributes traces across N time buckets.
func (s *Store) GetTimeseries(buckets int) []TimeseriesBucket {
	return []TimeseriesBucket{}
}

// GetPromptBaselines returns per-prompt baseline metrics from the most recent N traces.
// If window is 0, all traces are included.
func (s *Store) GetPromptBaselines(window int) []PromptBaseline {
	return []PromptBaseline{}
}

// GetCompositionStats returns aggregated composition analytics grouped by kind.
func (s *Store) GetCompositionStats() CompositionStatsResult {
	s.mu.RLock()
	defer s.mu.RUnlock()

	type kindAcc struct {
		total         int
		success       int
		errorCount    int
		totalDuration float64
		totalAgents   int
	}

	byKind := make(map[string]*kindAcc)

	for _, e := range s.compositionEvents.Items() {
		if e.Kind != "end" {
			continue
		}
		acc := byKind[e.CompositionKind]
		if acc == nil {
			acc = &kindAcc{}
			byKind[e.CompositionKind] = acc
		}
		acc.total++
		if e.Status == "success" {
			acc.success++
		} else if e.Status == "error" {
			acc.errorCount++
		}
		if e.DurationMs != nil {
			acc.totalDuration += *e.DurationMs
		}
		if e.AgentCount != nil {
			acc.totalAgents += *e.AgentCount
		}
	}

	resultByKind := make(map[string]CompositionKindStatsResult, len(byKind))
	for kind, acc := range byKind {
		var avgDuration, avgAgents float64
		if acc.total > 0 {
			avgDuration = math.Round(acc.totalDuration / float64(acc.total))
			avgAgents = float64(acc.totalAgents) / float64(acc.total)
		}
		resultByKind[kind] = CompositionKindStatsResult{
			Total:         acc.total,
			Success:       acc.success,
			Error:         acc.errorCount,
			AvgDurationMs: avgDuration,
			AvgAgents:     avgAgents,
		}
	}

	return CompositionStatsResult{
		ByKind: resultByKind,
	}
}

// GetDroppedContextFrequency counts how often each context is dropped across traces.
func (s *Store) GetDroppedContextFrequency() map[string]DroppedContextFrequency {
	return map[string]DroppedContextFrequency{}
}

// GetAllEvents returns a timeline of all events, optionally filtered by session.
func (s *Store) GetAllEvents(sessionFilter string) []TimelineEvent {
	return []TimelineEvent{}
}

// GetJudgeTimeseries distributes judge events across N time buckets, grouped by metric.
func (s *Store) GetJudgeTimeseries(buckets int) []JudgeTimeseriesBucket {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := s.judgeEvents.Items()
	if len(items) == 0 || buckets <= 0 {
		return []JudgeTimeseriesBucket{}
	}

	var minT, maxT int64
	minT = math.MaxInt64
	maxT = math.MinInt64
	for _, je := range items {
		if je.Timestamp < minT {
			minT = je.Timestamp
		}
		if je.Timestamp > maxT {
			maxT = je.Timestamp
		}
	}
	if minT == maxT {
		maxT = minT + 1
	}

	bucketSize := float64(maxT-minT) / float64(buckets)

	result := make([]JudgeTimeseriesBucket, buckets)
	bucketMetrics := make([]map[string][]float64, buckets)
	for i := range result {
		result[i].T = minT + int64(float64(i)*bucketSize)
		result[i].ByMetric = make(map[string]JudgeMetricBucket)
		bucketMetrics[i] = make(map[string][]float64)
	}

	for _, je := range items {
		idx := int(float64(je.Timestamp-minT) / bucketSize)
		if idx >= buckets {
			idx = buckets - 1
		}
		bucketMetrics[idx][je.Metric] = append(bucketMetrics[idx][je.Metric], je.Score)
	}

	for i, metrics := range bucketMetrics {
		for metricID, scores := range metrics {
			var sum float64
			for _, sc := range scores {
				sum += sc
			}
			result[i].ByMetric[metricID] = JudgeMetricBucket{
				Avg:   sum / float64(len(scores)),
				Count: len(scores),
			}
		}
	}

	return result
}

// PromptUsageStat tracks usage statistics for a single prompt ID.
type PromptUsageStat struct {
	Count         int     `json:"count"`
	LastUsed      int64   `json:"lastUsed"`
	ErrorCount    int     `json:"errorCount"`
	AvgDurationMs float64 `json:"avgDurationMs"`
	TotalCost     float64 `json:"totalCost"`
}

// GetPromptUsageStats returns per-prompt aggregated usage statistics.
func (s *Store) GetPromptUsageStats() map[string]PromptUsageStat {
	return map[string]PromptUsageStat{}
}
