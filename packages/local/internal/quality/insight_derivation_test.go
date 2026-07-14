package quality

import (
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
)

func TestDeriveInsightsPureBehavior(t *testing.T) {
	now := time.Date(2026, 6, 11, 12, 30, 0, 0, time.UTC)
	resolvedAt := now.Add(-time.Hour).Format(time.RFC3339Nano)

	tests := []struct {
		name   string
		input  qualityInsightInputs
		assert func(*testing.T, []qualityInsightRecord)
	}{
		{
			name: "historical incomplete run is medium after later success",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{},
				Now:     now,
				Runs: []qualityRunRecord{
					{TraceID: "successful-smoke", TargetID: "smoke", Status: "ok", StartedAt: now.UnixMilli()},
					{TraceID: "stale-smoke", TargetID: "smoke", Status: "incomplete", StartedAt: now.Add(-time.Minute).UnixMilli()},
					{TraceID: "successful-other", TargetID: "other", Status: "success", StartedAt: now.Add(time.Minute).UnixMilli()},
				},
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				insight := derivedInsightByID(insights, "run-lifecycle-stale-smoke")
				if insight == nil {
					t.Fatalf("missing inspectable lifecycle insight in %#v", insights)
				}
				if insight.Severity != "medium" {
					t.Fatalf("lifecycle insight severity = %q, want medium", insight.Severity)
				}
			},
		},
		{
			name: "unmitigated incomplete run remains high",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{},
				Now:     now,
				Runs: []qualityRunRecord{
					{TraceID: "incomplete-smoke", TargetID: "smoke", Status: "incomplete", StartedAt: now.UnixMilli()},
					{TraceID: "simultaneous-smoke", TargetID: "smoke", Status: "success", StartedAt: now.UnixMilli()},
					{TraceID: "successful-other", TargetID: "other", Status: "success", StartedAt: now.Add(time.Minute).UnixMilli()},
				},
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				insight := derivedInsightByID(insights, "run-lifecycle-incomplete-smoke")
				if insight == nil {
					t.Fatalf("missing inspectable lifecycle insight in %#v", insights)
				}
				if insight.Severity != "high" {
					t.Fatalf("lifecycle insight severity = %q, want high", insight.Severity)
				}
			},
		},
		{
			name: "incomplete run with unknown timestamp remains high",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{},
				Now:     now,
				Runs: []qualityRunRecord{
					{TraceID: "incomplete-unknown", TargetID: "smoke", Status: "incomplete", StartedAt: 0},
					{TraceID: "successful-smoke", TargetID: "smoke", Status: "success", StartedAt: now.UnixMilli()},
				},
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				insight := derivedInsightByID(insights, "run-lifecycle-incomplete-unknown")
				if insight == nil || insight.Severity != "high" {
					t.Fatalf("lifecycle insight = %#v, want high severity", insight)
				}
			},
		},
		{
			name: "invalid success timestamp does not mitigate incomplete run",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{},
				Now:     now,
				Runs: []qualityRunRecord{
					{TraceID: "incomplete-invalid", TargetID: "smoke", Status: "incomplete", StartedAt: -1},
					{TraceID: "successful-unknown", TargetID: "smoke", Status: "success", StartedAt: 0},
				},
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				insight := derivedInsightByID(insights, "run-lifecycle-incomplete-invalid")
				if insight == nil || insight.Severity != "high" {
					t.Fatalf("lifecycle insight = %#v, want high severity", insight)
				}
			},
		},
		{
			name: "patterns suppress covered per-run signals",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{},
				Now:     now,
				Runs: []qualityRunRecord{
					{
						TraceID:               "run-a",
						TargetID:              "karyla-agent",
						Status:                "suspended",
						StartedAt:             now.Add(-time.Hour).UnixMilli(),
						TokenCount:            12000,
						SuspensionSignalCount: 1,
					},
					{
						TraceID:               "run-b",
						TargetID:              "writer-agent",
						Status:                "suspended",
						StartedAt:             now.UnixMilli(),
						TokenCount:            13000,
						SuspensionSignalCount: 1,
					},
				},
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				titles := derivedInsightTitles(insights)
				if titles["Usage without cost is recurring"] != 1 || titles["Suspensions are recurring"] != 1 {
					t.Fatalf("titles = %#v, want global missing-cost and suspension patterns", titles)
				}
				if titles["Run has usage without cost"] != 0 || titles["Run is waiting on a suspension"] != 0 {
					t.Fatalf("titles = %#v, want covered per-run signals suppressed", titles)
				}
			},
		},
		{
			name: "resolved pattern reopens when occurrence count grows",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{
					Statuses: map[string]qualityfs.InsightStatus{
						"pattern-high-token-karyla-agent": {
							InsightID:           "pattern-high-token-karyla-agent",
							Status:              "resolved",
							UpdatedAt:           resolvedAt,
							ResolvedAt:          resolvedAt,
							ResolvedOccurrences: 2,
						},
					},
				},
				Now: now,
				Runs: []qualityRunRecord{
					{TraceID: "run-a", TargetID: "karyla-agent", Status: "success", StartedAt: now.Add(-3 * time.Minute).UnixMilli(), TokenCount: 12000},
					{TraceID: "run-b", TargetID: "karyla-agent", Status: "success", StartedAt: now.Add(-2 * time.Minute).UnixMilli(), TokenCount: 13000},
					{TraceID: "run-c", TargetID: "karyla-agent", Status: "success", StartedAt: now.Add(-1 * time.Minute).UnixMilli(), TokenCount: 14000},
				},
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				insight := derivedInsightByID(insights, "pattern-high-token-karyla-agent")
				if insight == nil {
					t.Fatalf("missing reopened pattern insight in %#v", insights)
				}
				if insight.Status != "open" || insight.ReopenedAt != now.Format(time.RFC3339Nano) || insight.PreviousResolutionAt != resolvedAt {
					t.Fatalf("insight = %#v, want reopened with explicit now", *insight)
				}
			},
		},
		{
			name: "active silence filters matching title and target",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{
					Silences: []qualityfs.InsightSilence{
						{
							ID:      "silence-1",
							Pattern: qualityfs.InsightSilencePattern{Title: "Run has high token usage", TargetID: "karyla-agent"},
						},
					},
				},
				Now: now,
				Runs: []qualityRunRecord{
					{TraceID: "run-a", TargetID: "karyla-agent", Status: "success", StartedAt: now.UnixMilli(), TokenCount: 12000},
				},
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				if derivedInsightByID(insights, "high-token-usage-run-a") != nil {
					t.Fatalf("insights = %#v, want target-specific high-token insight silenced", insights)
				}
			},
		},
		{
			name: "title-only silence filters all targets",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{
					Silences: []qualityfs.InsightSilence{
						{
							ID:      "silence-1",
							Pattern: qualityfs.InsightSilencePattern{Title: "Run has high token usage"},
						},
					},
				},
				Now: now,
				Runs: []qualityRunRecord{
					{TraceID: "run-a", TargetID: "karyla-agent", Status: "success", StartedAt: now.UnixMilli(), TokenCount: 12000},
				},
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				if derivedInsightByID(insights, "high-token-usage-run-a") != nil {
					t.Fatalf("insights = %#v, want title-only high-token insight silenced", insights)
				}
			},
		},
		{
			name: "repeated patterns compute trace links trends and detail stats",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{},
				Now:     now,
				Runs: []qualityRunRecord{
					{TraceID: "run-a", TargetID: "docs-agent", Status: "success", StartedAt: now.Add(-3 * time.Hour).UnixMilli(), DurationMs: ptrFloat(75000), Cost: ptrFloat(0.05), TokenCount: 12000},
					{TraceID: "run-b", TargetID: "docs-agent", Status: "success", StartedAt: now.Add(-2 * time.Hour).UnixMilli(), DurationMs: ptrFloat(75000), Cost: ptrFloat(0.06), TokenCount: 13000},
					{TraceID: "run-c", TargetID: "docs-agent", Status: "success", StartedAt: now.Add(-1 * time.Hour).UnixMilli(), DurationMs: ptrFloat(75000), Cost: ptrFloat(0.07), TokenCount: 14000},
				},
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				pattern := derivedInsightByID(insights, "pattern-high-token-docs-agent")
				if pattern == nil {
					t.Fatalf("missing repeated pattern insight in %#v", insights)
				}
				if len(pattern.LinkedTraceIDs) != 3 || pattern.OccurrenceCount != 3 {
					t.Fatalf("pattern trace links = %#v occurrence = %d", pattern.LinkedTraceIDs, pattern.OccurrenceCount)
				}
				if len(pattern.Trend) != 12 || pattern.Trend[8] != 1 || pattern.Trend[9] != 1 || pattern.Trend[10] != 1 {
					t.Fatalf("pattern trend = %#v, want three recent hourly occurrences", pattern.Trend)
				}
				if pattern.DetailStats == nil || pattern.DetailStats.TokensDeltaVsBaseline == "n/a" || pattern.DetailStats.CostDeltaVsBaseline == "n/a" || pattern.DetailStats.LatencyDeltaVsBaseline == "n/a" {
					t.Fatalf("pattern detail stats = %#v, want real deltas", pattern.DetailStats)
				}
			},
		},
		{
			name: "old runs use relative trend fallback",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{},
				Now:     now,
				Runs: []qualityRunRecord{
					{TraceID: "old-run", TargetID: "karyla-agent", Status: "success", StartedAt: now.Add(-72 * time.Hour).UnixMilli(), TokenCount: 12000},
				},
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				highToken := derivedInsightByID(insights, "high-token-usage-old-run")
				if highToken == nil {
					t.Fatalf("missing high token insight in %#v", insights)
				}
				if len(highToken.Trend) != 12 || highToken.Trend[11] != 1 {
					t.Fatalf("trend = %#v, want single old occurrence visible in fallback bucket", highToken.Trend)
				}
			},
		},
		{
			name: "resolved insights stay resolved when occurrence count is unchanged or lower",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{
					Statuses: map[string]qualityfs.InsightStatus{
						"pattern-high-token-karyla-agent": {
							InsightID:           "pattern-high-token-karyla-agent",
							Status:              "resolved",
							UpdatedAt:           resolvedAt,
							ResolvedAt:          resolvedAt,
							ResolvedOccurrences: 2,
						},
						"high-token-usage-run-a": {
							InsightID:           "high-token-usage-run-a",
							Status:              "resolved",
							UpdatedAt:           resolvedAt,
							ResolvedAt:          resolvedAt,
							ResolvedOccurrences: 2,
						},
					},
				},
				Now: now,
				Runs: []qualityRunRecord{
					{TraceID: "run-a", TargetID: "karyla-agent", Status: "success", StartedAt: now.Add(-2 * time.Minute).UnixMilli(), TokenCount: 12000},
					{TraceID: "run-b", TargetID: "karyla-agent", Status: "success", StartedAt: now.Add(-1 * time.Minute).UnixMilli(), TokenCount: 13000},
				},
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				pattern := derivedInsightByID(insights, "pattern-high-token-karyla-agent")
				if pattern == nil || pattern.Status != "resolved" || pattern.ReopenedAt != "" {
					t.Fatalf("pattern = %#v, want still resolved", pattern)
				}
			},
		},
		{
			name: "resolved per-run insight stays resolved when occurrence count drops",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{
					Statuses: map[string]qualityfs.InsightStatus{
						"high-token-usage-run-a": {
							InsightID:           "high-token-usage-run-a",
							Status:              "resolved",
							UpdatedAt:           resolvedAt,
							ResolvedAt:          resolvedAt,
							ResolvedOccurrences: 2,
						},
					},
				},
				Now: now,
				Runs: []qualityRunRecord{
					{TraceID: "run-a", TargetID: "karyla-agent", Status: "success", StartedAt: now.UnixMilli(), TokenCount: 12000},
				},
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				single := derivedInsightByID(insights, "high-token-usage-run-a")
				if single == nil || single.Status != "resolved" || single.ReopenedAt != "" {
					t.Fatalf("single = %#v, want still resolved after count drop", single)
				}
			},
		},
		{
			name: "quality snapshot records derive without loading files",
			input: qualityInsightInputs{
				Quality: &qualityfs.Snapshot{
					Feedback: []qualityfs.Feedback{
						{ID: "feedback-1", Status: "new", TraceID: ptrString("trace-1"), CreatedAt: now.Format(time.RFC3339Nano)},
					},
					Cassettes: []qualityfs.Cassette{
						{Path: "sample.cassette.json", MissingCount: 1, MismatchCount: 1},
					},
				},
				SpecExperiments: []qualityfs.ExperimentRecordFile{
					{Record: qualityfs.ExperimentRecord{
						ExperimentID: "experiment-1",
						EvaluationID: "evals.sample",
						EndedAt:      now.Format(time.RFC3339Nano),
						Cells: []qualityfs.SpecExperimentCell{
							{CaseID: "case-1", Status: "failed"},
						},
					}},
				},
				Now: now,
			},
			assert: func(t *testing.T, insights []qualityInsightRecord) {
				t.Helper()
				for _, id := range []string{"experiment-experiment-1", "feedback-feedback-1", "cassette-sample.cassette.json"} {
					if derivedInsightByID(insights, id) == nil {
						t.Fatalf("missing %s in %#v", id, insights)
					}
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.assert(t, deriveInsights(tt.input))
		})
	}
}

func derivedInsightTitles(insights []qualityInsightRecord) map[string]int {
	titles := map[string]int{}
	for _, insight := range insights {
		titles[insight.Title]++
	}
	return titles
}

func derivedInsightByID(insights []qualityInsightRecord, id string) *qualityInsightRecord {
	for index := range insights {
		if insights[index].InsightID == id {
			return &insights[index]
		}
	}
	return nil
}

func ptrString(value string) *string {
	return &value
}

func ptrFloat(value float64) *float64 {
	return &value
}
