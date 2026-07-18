package inspect

import (
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/inspectfs"
)

func TestDeriveInsightsPureBehavior(t *testing.T) {
	now := time.Date(2026, 6, 11, 12, 30, 0, 0, time.UTC)
	resolvedAt := now.Add(-time.Hour).Format(time.RFC3339Nano)

	tests := []struct {
		name   string
		input  inspectInsightInputs
		assert func(*testing.T, []inspectInsightRecord)
	}{
		{
			name: "historical incomplete run is medium after later success",
			input: inspectInsightInputs{
				Now: now,
				Runs: []inspectRunRecord{
					{TraceID: "successful-smoke", TargetID: "smoke", Status: "ok", StartedAt: now.UnixMilli()},
					{TraceID: "stale-smoke", TargetID: "smoke", Status: "incomplete", StartedAt: now.Add(-time.Minute).UnixMilli()},
					{TraceID: "successful-other", TargetID: "other", Status: "success", StartedAt: now.Add(time.Minute).UnixMilli()},
				},
			},
			assert: func(t *testing.T, insights []inspectInsightRecord) {
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
			input: inspectInsightInputs{
				Now: now,
				Runs: []inspectRunRecord{
					{TraceID: "incomplete-smoke", TargetID: "smoke", Status: "incomplete", StartedAt: now.UnixMilli()},
					{TraceID: "simultaneous-smoke", TargetID: "smoke", Status: "success", StartedAt: now.UnixMilli()},
					{TraceID: "successful-other", TargetID: "other", Status: "success", StartedAt: now.Add(time.Minute).UnixMilli()},
				},
			},
			assert: func(t *testing.T, insights []inspectInsightRecord) {
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
			input: inspectInsightInputs{
				Now: now,
				Runs: []inspectRunRecord{
					{TraceID: "incomplete-unknown", TargetID: "smoke", Status: "incomplete", StartedAt: 0},
					{TraceID: "successful-smoke", TargetID: "smoke", Status: "success", StartedAt: now.UnixMilli()},
				},
			},
			assert: func(t *testing.T, insights []inspectInsightRecord) {
				t.Helper()
				insight := derivedInsightByID(insights, "run-lifecycle-incomplete-unknown")
				if insight == nil || insight.Severity != "high" {
					t.Fatalf("lifecycle insight = %#v, want high severity", insight)
				}
			},
		},
		{
			name: "invalid success timestamp does not mitigate incomplete run",
			input: inspectInsightInputs{
				Now: now,
				Runs: []inspectRunRecord{
					{TraceID: "incomplete-invalid", TargetID: "smoke", Status: "incomplete", StartedAt: -1},
					{TraceID: "successful-unknown", TargetID: "smoke", Status: "success", StartedAt: 0},
				},
			},
			assert: func(t *testing.T, insights []inspectInsightRecord) {
				t.Helper()
				insight := derivedInsightByID(insights, "run-lifecycle-incomplete-invalid")
				if insight == nil || insight.Severity != "high" {
					t.Fatalf("lifecycle insight = %#v, want high severity", insight)
				}
			},
		},
		{
			name: "patterns suppress covered per-run signals",
			input: inspectInsightInputs{
				Now: now,
				Runs: []inspectRunRecord{
					{
						TraceID:               "run-a",
						TargetID:              "support-agent",
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
			assert: func(t *testing.T, insights []inspectInsightRecord) {
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
			input: inspectInsightInputs{
				Statuses: map[string]inspectfs.InsightStatus{
					"pattern-high-token-support-agent": {
						InsightID:           "pattern-high-token-support-agent",
						Status:              "resolved",
						UpdatedAt:           resolvedAt,
						ResolvedAt:          resolvedAt,
						ResolvedOccurrences: 2,
					},
				},
				Now: now,
				Runs: []inspectRunRecord{
					{TraceID: "run-a", TargetID: "support-agent", Status: "success", StartedAt: now.Add(-3 * time.Minute).UnixMilli(), TokenCount: 12000},
					{TraceID: "run-b", TargetID: "support-agent", Status: "success", StartedAt: now.Add(-2 * time.Minute).UnixMilli(), TokenCount: 13000},
					{TraceID: "run-c", TargetID: "support-agent", Status: "success", StartedAt: now.Add(-1 * time.Minute).UnixMilli(), TokenCount: 14000},
				},
			},
			assert: func(t *testing.T, insights []inspectInsightRecord) {
				t.Helper()
				insight := derivedInsightByID(insights, "pattern-high-token-support-agent")
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
			input: inspectInsightInputs{
				Silences: []inspectfs.InsightSilence{
					{
						ID:      "silence-1",
						Pattern: inspectfs.InsightSilencePattern{Title: "Run has high token usage", TargetID: "support-agent"},
					},
				},
				Now: now,
				Runs: []inspectRunRecord{
					{TraceID: "run-a", TargetID: "support-agent", Status: "success", StartedAt: now.UnixMilli(), TokenCount: 12000},
				},
			},
			assert: func(t *testing.T, insights []inspectInsightRecord) {
				t.Helper()
				if derivedInsightByID(insights, "high-token-usage-run-a") != nil {
					t.Fatalf("insights = %#v, want target-specific high-token insight silenced", insights)
				}
			},
		},
		{
			name: "title-only silence filters all targets",
			input: inspectInsightInputs{
				Silences: []inspectfs.InsightSilence{
					{
						ID:      "silence-1",
						Pattern: inspectfs.InsightSilencePattern{Title: "Run has high token usage"},
					},
				},
				Now: now,
				Runs: []inspectRunRecord{
					{TraceID: "run-a", TargetID: "support-agent", Status: "success", StartedAt: now.UnixMilli(), TokenCount: 12000},
				},
			},
			assert: func(t *testing.T, insights []inspectInsightRecord) {
				t.Helper()
				if derivedInsightByID(insights, "high-token-usage-run-a") != nil {
					t.Fatalf("insights = %#v, want title-only high-token insight silenced", insights)
				}
			},
		},
		{
			name: "repeated patterns compute trace links trends and detail stats",
			input: inspectInsightInputs{
				Now: now,
				Runs: []inspectRunRecord{
					{TraceID: "run-a", TargetID: "docs-agent", Status: "success", StartedAt: now.Add(-3 * time.Hour).UnixMilli(), DurationMs: ptrFloat(75000), Cost: ptrFloat(0.05), TokenCount: 12000},
					{TraceID: "run-b", TargetID: "docs-agent", Status: "success", StartedAt: now.Add(-2 * time.Hour).UnixMilli(), DurationMs: ptrFloat(75000), Cost: ptrFloat(0.06), TokenCount: 13000},
					{TraceID: "run-c", TargetID: "docs-agent", Status: "success", StartedAt: now.Add(-1 * time.Hour).UnixMilli(), DurationMs: ptrFloat(75000), Cost: ptrFloat(0.07), TokenCount: 14000},
				},
			},
			assert: func(t *testing.T, insights []inspectInsightRecord) {
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
			input: inspectInsightInputs{
				Now: now,
				Runs: []inspectRunRecord{
					{TraceID: "old-run", TargetID: "support-agent", Status: "success", StartedAt: now.Add(-72 * time.Hour).UnixMilli(), TokenCount: 12000},
				},
			},
			assert: func(t *testing.T, insights []inspectInsightRecord) {
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
			input: inspectInsightInputs{
				Statuses: map[string]inspectfs.InsightStatus{
					"pattern-high-token-support-agent": {
						InsightID:           "pattern-high-token-support-agent",
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
				Now: now,
				Runs: []inspectRunRecord{
					{TraceID: "run-a", TargetID: "support-agent", Status: "success", StartedAt: now.Add(-2 * time.Minute).UnixMilli(), TokenCount: 12000},
					{TraceID: "run-b", TargetID: "support-agent", Status: "success", StartedAt: now.Add(-1 * time.Minute).UnixMilli(), TokenCount: 13000},
				},
			},
			assert: func(t *testing.T, insights []inspectInsightRecord) {
				t.Helper()
				pattern := derivedInsightByID(insights, "pattern-high-token-support-agent")
				if pattern == nil || pattern.Status != "resolved" || pattern.ReopenedAt != "" {
					t.Fatalf("pattern = %#v, want still resolved", pattern)
				}
			},
		},
		{
			name: "resolved per-run insight stays resolved when occurrence count drops",
			input: inspectInsightInputs{
				Statuses: map[string]inspectfs.InsightStatus{
					"high-token-usage-run-a": {
						InsightID:           "high-token-usage-run-a",
						Status:              "resolved",
						UpdatedAt:           resolvedAt,
						ResolvedAt:          resolvedAt,
						ResolvedOccurrences: 2,
					},
				},
				Now: now,
				Runs: []inspectRunRecord{
					{TraceID: "run-a", TargetID: "support-agent", Status: "success", StartedAt: now.UnixMilli(), TokenCount: 12000},
				},
			},
			assert: func(t *testing.T, insights []inspectInsightRecord) {
				t.Helper()
				single := derivedInsightByID(insights, "high-token-usage-run-a")
				if single == nil || single.Status != "resolved" || single.ReopenedAt != "" {
					t.Fatalf("single = %#v, want still resolved after count drop", single)
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

func derivedInsightTitles(insights []inspectInsightRecord) map[string]int {
	titles := map[string]int{}
	for _, insight := range insights {
		titles[insight.Title]++
	}
	return titles
}

func derivedInsightByID(insights []inspectInsightRecord, id string) *inspectInsightRecord {
	for index := range insights {
		if insights[index].InsightID == id {
			return &insights[index]
		}
	}
	return nil
}

func ptrFloat(value float64) *float64 {
	return &value
}
