package quality

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/cli/internal/observability"
	"github.com/use-crux/crux/packages/cli/internal/store"
)

func TestQualityPassRateHistoryBucketsExperiments(t *testing.T) {
	now := time.Now().UTC()
	experiments := []qualityExperimentRecord{
		{
			StartedAt: now.Add(-2 * time.Hour).Format(time.RFC3339Nano),
			EndedAt:   now.Add(-1 * time.Hour).Format(time.RFC3339Nano),
			Summary: struct {
				Total   int `json:"total"`
				Passed  int `json:"passed"`
				Failed  int `json:"failed"`
				Errored int `json:"errored"`
			}{Total: 4, Passed: 3},
		},
	}

	history := qualityPassRateHistory(experiments)
	if len(history) != 14 {
		t.Fatalf("history length = %d, want 14", len(history))
	}
	if history[len(history)-1] != 0.75 {
		t.Fatalf("latest pass rate = %v, want 0.75", history[len(history)-1])
	}
}

func TestEnrichQualityExperimentComputesVariantWinnerAndDelta(t *testing.T) {
	experiment := enrichQualityExperiment(qualityExperimentRecord{
		Cases: []qualityExperimentCase{
			{CaseID: "a", VariantID: "base", Status: "passed", DurationMs: 100},
			{CaseID: "b", VariantID: "base", Status: "failed", DurationMs: 200},
			{CaseID: "a", VariantID: "candidate", Status: "passed", DurationMs: 100},
			{CaseID: "b", VariantID: "candidate", Status: "passed", DurationMs: 200},
		},
		Variants: []qualityExperimentVariant{
			{ID: "base", TargetID: "base", IsBaseline: true},
			{ID: "candidate", TargetID: "candidate"},
		},
	})

	if experiment.Variants[1].PassRate == nil || *experiment.Variants[1].PassRate != 1 {
		t.Fatalf("candidate pass rate = %v, want 1", experiment.Variants[1].PassRate)
	}
	if !experiment.Variants[1].IsWinner {
		t.Fatal("candidate should be winner")
	}
	if experiment.Variants[1].BaselineDeltaPassPts == nil || *experiment.Variants[1].BaselineDeltaPassPts != 50 {
		t.Fatalf("candidate baseline delta = %v, want 50", experiment.Variants[1].BaselineDeltaPassPts)
	}
}

func TestServiceRunsUsesObservabilityWhenAvailable(t *testing.T) {
	ctx := context.Background()
	obs, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer obs.Close()

	raw, err := os.ReadFile("../../../core/observability/fixtures/generation-run.json")
	if err != nil {
		t.Fatal(err)
	}
	var batch observability.Batch
	if err := json.Unmarshal(raw, &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(store.NewStore(), t.TempDir()).WithObservability(obs)
	runs, err := service.Runs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 {
		t.Fatalf("runs len = %d, want 1", len(runs))
	}
	run := runs[0]
	if run.TraceID != "run_generation_fixture_01" || run.PromptID == nil || *run.PromptID != "support.reply" {
		t.Fatalf("run identity = %#v", run)
	}
	if run.Model != "gpt-4o" || run.Provider != "openai" || run.TokenCount != 60 {
		t.Fatalf("run summary = %#v", run)
	}
	if run.Cost == nil || *run.Cost != 0.00042 {
		t.Fatalf("run cost = %#v", run.Cost)
	}

	detail, found, err := service.RunDetail(ctx, "run_generation_fixture_01")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("detail not found")
	}
	if len(detail.Spans) != 1 || len(detail.Narrative) == 0 || detail.Trace.Input["messages"] == nil {
		t.Fatalf("detail = %#v", detail)
	}
}

func TestServiceInsightsDeriveObservabilityAttentionItems(t *testing.T) {
	ctx := context.Background()
	obs, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer obs.Close()

	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{"records":[
		{"schemaVersion":1,"recordId":"run-start","type":"run:start","runId":"run_attention","traceId":"trace_attention","name":"support-agent","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"agent-start","type":"span:start","runId":"run_attention","traceId":"trace_attention","spanId":"span_agent","family":"agent","primitive":"agent.run","name":"support-agent","startedAt":"2026-05-16T18:00:00.001Z","status":"running","promptId":"support-agent"},
		{"schemaVersion":1,"recordId":"tool-start","type":"span:start","runId":"run_attention","traceId":"trace_attention","spanId":"span_tool","parentSpanId":"span_agent","family":"tool","primitive":"tool.call","name":"searchDocs","startedAt":"2026-05-16T18:00:01.000Z","status":"running","toolName":"searchDocs"},
		{"schemaVersion":1,"recordId":"tool-end","type":"span:end","runId":"run_attention","traceId":"trace_attention","spanId":"span_tool","endedAt":"2026-05-16T18:00:01.100Z","durationMs":100,"status":"error","error":{"message":"search failed"}},
		{"schemaVersion":1,"recordId":"score-start","type":"span:start","runId":"run_attention","traceId":"trace_attention","spanId":"span_score","parentSpanId":"span_agent","family":"scoring","primitive":"scoring.judge","name":"citation-validity","startedAt":"2026-05-16T18:00:02.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"score-end","type":"span:end","runId":"run_attention","traceId":"trace_attention","spanId":"span_score","endedAt":"2026-05-16T18:00:02.100Z","durationMs":100,"status":"blocked"},
		{"schemaVersion":1,"recordId":"agent-end","type":"span:end","runId":"run_attention","traceId":"trace_attention","spanId":"span_agent","endedAt":"2026-05-16T18:01:20.000Z","durationMs":80000,"status":"ok","metrics":{"totalTokens":18000}},
		{"schemaVersion":1,"recordId":"run-end","type":"run:end","runId":"run_attention","traceId":"trace_attention","endedAt":"2026-05-16T18:01:20.000Z","durationMs":80000,"status":"ok","metrics":{"totalTokens":18000}}
	]}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(store.NewStore(), t.TempDir()).WithObservability(obs)
	insights, err := service.Insights(ctx)
	if err != nil {
		t.Fatal(err)
	}
	titles := map[string]bool{}
	for _, insight := range insights {
		titles[insight.Title] = true
		if insight.Title == "Tool calls failed" && (len(insight.LinkedTraceIDs) != 1 || insight.TargetID != "support-agent") {
			t.Fatalf("tool insight = %#v", insight)
		}
	}
	for _, title := range []string{
		"Run is slow",
		"Run has high token usage",
		"Run has usage without cost",
		"Tool calls failed",
		"Safety, guardrail, or scoring signal needs attention",
	} {
		if !titles[title] {
			t.Fatalf("missing insight %q in %#v", title, titles)
		}
	}
}

func TestServiceInsightsGroupRepeatedPatternsAndComputeTrends(t *testing.T) {
	ctx := context.Background()
	obs, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer obs.Close()

	now := time.Now().UTC().Truncate(time.Hour)
	records := []string{}
	for i, offset := range []time.Duration{-3 * time.Hour, -2 * time.Hour, -1 * time.Hour} {
		runID := fmt.Sprintf("run_pattern_%d", i+1)
		traceID := fmt.Sprintf("trace_pattern_%d", i+1)
		spanID := fmt.Sprintf("span_pattern_%d", i+1)
		started := now.Add(offset)
		ended := started.Add(75 * time.Second)
		records = append(records,
			fmt.Sprintf(`{"schemaVersion":1,"recordId":"%s-start","type":"run:start","runId":%q,"traceId":%q,"name":"docs-agent","rootPrimitive":"agent.run","startedAt":%q,"status":"running"}`, runID, runID, traceID, started.Format(time.RFC3339Nano)),
			fmt.Sprintf(`{"schemaVersion":1,"recordId":"%s-span-start","type":"span:start","runId":%q,"traceId":%q,"spanId":%q,"family":"agent","primitive":"agent.run","name":"docs-agent","startedAt":%q,"status":"running","promptId":"docs-agent"}`, runID, runID, traceID, spanID, started.Add(time.Millisecond).Format(time.RFC3339Nano)),
			fmt.Sprintf(`{"schemaVersion":1,"recordId":"%s-span-end","type":"span:end","runId":%q,"traceId":%q,"spanId":%q,"endedAt":%q,"durationMs":75000,"status":"ok","metrics":{"totalTokens":%d,"costUsd":%f}}`, runID, runID, traceID, spanID, ended.Format(time.RFC3339Nano), 12000+i*1000, 0.05+float64(i)*0.01),
			fmt.Sprintf(`{"schemaVersion":1,"recordId":"%s-end","type":"run:end","runId":%q,"traceId":%q,"endedAt":%q,"durationMs":75000,"status":"ok","metrics":{"totalTokens":%d,"costUsd":%f}}`, runID, runID, traceID, ended.Format(time.RFC3339Nano), 12000+i*1000, 0.05+float64(i)*0.01),
		)
	}
	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{"records":[`+joinJSONRecords(records)+`]}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(store.NewStore(), t.TempDir()).WithObservability(obs)
	insights, err := service.Insights(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var pattern *qualityInsightRecord
	for index := range insights {
		if insights[index].Title == "Repeated high token usage pattern" {
			pattern = &insights[index]
			break
		}
	}
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
}

func TestServiceInsightsSuppressPerRunItemsCoveredByGlobalPattern(t *testing.T) {
	ctx := context.Background()
	obs, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer obs.Close()

	now := time.Now().UTC().Truncate(time.Hour)
	records := []string{}
	for i, target := range []string{"docs-agent", "support-agent", "research-agent"} {
		runID := fmt.Sprintf("run_global_pattern_%d", i+1)
		traceID := fmt.Sprintf("trace_global_pattern_%d", i+1)
		spanID := fmt.Sprintf("span_global_pattern_%d", i+1)
		started := now.Add(time.Duration(i-2) * time.Hour)
		ended := started.Add(20 * time.Second)
		records = append(records,
			fmt.Sprintf(`{"schemaVersion":1,"recordId":"%s-start","type":"run:start","runId":%q,"traceId":%q,"name":%q,"rootPrimitive":"agent.run","startedAt":%q,"status":"running"}`, runID, runID, traceID, target, started.Format(time.RFC3339Nano)),
			fmt.Sprintf(`{"schemaVersion":1,"recordId":"%s-span-start","type":"span:start","runId":%q,"traceId":%q,"spanId":%q,"family":"agent","primitive":"agent.run","name":%q,"startedAt":%q,"status":"running","promptId":%q}`, runID, runID, traceID, spanID, target, started.Add(time.Millisecond).Format(time.RFC3339Nano), target),
			fmt.Sprintf(`{"schemaVersion":1,"recordId":"%s-span-end","type":"span:end","runId":%q,"traceId":%q,"spanId":%q,"endedAt":%q,"durationMs":20000,"status":"ok","metrics":{"totalTokens":15000,"costUsd":0.020000}}`, runID, runID, traceID, spanID, ended.Format(time.RFC3339Nano)),
			fmt.Sprintf(`{"schemaVersion":1,"recordId":"%s-end","type":"run:end","runId":%q,"traceId":%q,"endedAt":%q,"durationMs":20000,"status":"ok","metrics":{"totalTokens":15000,"costUsd":0.020000}}`, runID, runID, traceID, ended.Format(time.RFC3339Nano)),
		)
	}
	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{"records":[`+joinJSONRecords(records)+`]}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(store.NewStore(), t.TempDir()).WithObservability(obs)
	insights, err := service.Insights(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var global *qualityInsightRecord
	perRunHighToken := 0
	for index := range insights {
		if insights[index].Title == "High token usage is recurring" {
			global = &insights[index]
		}
		if insights[index].Title == "Run has high token usage" {
			perRunHighToken++
		}
	}
	if global == nil {
		t.Fatalf("missing global high token pattern in %#v", insights)
	}
	if len(global.LinkedTraceIDs) != 3 || global.OccurrenceCount != 3 {
		t.Fatalf("global pattern = %#v", global)
	}
	if perRunHighToken != 0 {
		t.Fatalf("per-run high token insights = %d, want suppressed by global pattern", perRunHighToken)
	}
}

func TestServiceInsightsSuppressMissingCostAndSuspensionWhenPatternsExist(t *testing.T) {
	runs := []qualityRunRecord{
		{
			TraceID:               "run-a",
			TargetID:              "karyla-agent",
			Status:                "suspended",
			StartedAt:             time.Now().UTC().Add(-time.Hour).UnixMilli(),
			TokenCount:            12000,
			SuspensionSignalCount: 1,
		},
		{
			TraceID:               "run-b",
			TargetID:              "writer-agent",
			Status:                "suspended",
			StartedAt:             time.Now().UTC().UnixMilli(),
			TokenCount:            13000,
			SuspensionSignalCount: 1,
		},
	}
	insights, err := buildQualityInsightsFromRuns(t.TempDir(), runs)
	if err != nil {
		t.Fatal(err)
	}
	titles := map[string]int{}
	for _, insight := range insights {
		titles[insight.Title]++
	}
	if titles["Usage without cost is recurring"] != 1 {
		t.Fatalf("titles = %#v, want missing-cost pattern", titles)
	}
	if titles["Suspensions are recurring"] != 1 {
		t.Fatalf("titles = %#v, want suspension pattern", titles)
	}
	if titles["Run has usage without cost"] != 0 || titles["Run is waiting on a suspension"] != 0 {
		t.Fatalf("titles = %#v, want per-run missing-cost/suspension suppressed", titles)
	}
}

func TestServiceInsightsUseRelativeTrendWhenRunsAreOutsideRollingWindow(t *testing.T) {
	oldRun := qualityRunRecord{
		TraceID:    "old-run",
		TargetID:   "karyla-agent",
		Status:     "success",
		StartedAt:  time.Now().UTC().Add(-72 * time.Hour).UnixMilli(),
		TokenCount: 12000,
	}
	insights, err := buildQualityInsightsFromRuns(t.TempDir(), []qualityRunRecord{oldRun})
	if err != nil {
		t.Fatal(err)
	}
	var highToken *qualityInsightRecord
	for index := range insights {
		if insights[index].Title == "Run has high token usage" {
			highToken = &insights[index]
			break
		}
	}
	if highToken == nil {
		t.Fatalf("missing high token insight in %#v", insights)
	}
	if len(highToken.Trend) != 12 || highToken.Trend[11] != 1 {
		t.Fatalf("trend = %#v, want single old occurrence visible in fallback bucket", highToken.Trend)
	}
}

func TestServiceInsightsReopenResolvedWhenOccurrenceCountGrows(t *testing.T) {
	dir := t.TempDir()
	resolvedAt := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339Nano)
	if err := appendQualityJSONLine(filepath.Join(dir, "insights", "status.jsonl"), qualityInsightStatusRecord{
		Tag:                 "QualityInsightStatus",
		InsightID:           "pattern-high-token-karyla-agent",
		Status:              "resolved",
		UpdatedAt:           resolvedAt,
		ResolvedAt:          resolvedAt,
		ResolvedOccurrences: 2,
	}); err != nil {
		t.Fatal(err)
	}
	runs := []qualityRunRecord{
		{TraceID: "run-a", TargetID: "karyla-agent", Status: "success", StartedAt: time.Now().Add(-3 * time.Minute).UnixMilli(), TokenCount: 12000},
		{TraceID: "run-b", TargetID: "karyla-agent", Status: "success", StartedAt: time.Now().Add(-2 * time.Minute).UnixMilli(), TokenCount: 13000},
		{TraceID: "run-c", TargetID: "karyla-agent", Status: "success", StartedAt: time.Now().Add(-1 * time.Minute).UnixMilli(), TokenCount: 14000},
	}
	insights, err := buildQualityInsightsFromRuns(dir, runs)
	if err != nil {
		t.Fatal(err)
	}
	insight := findQualityInsightByID(insights, "pattern-high-token-karyla-agent")
	if insight == nil {
		t.Fatalf("missing pattern insight in %#v", insights)
	}
	if insight.Status != "open" || insight.ReopenedAt == "" || insight.PreviousResolutionAt != resolvedAt {
		t.Fatalf("insight = %#v, want reopened open insight", *insight)
	}
}

func TestServiceInsightsKeepResolvedWhenOccurrenceCountUnchangedOrDrops(t *testing.T) {
	dir := t.TempDir()
	resolvedAt := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339Nano)
	if err := appendQualityJSONLine(filepath.Join(dir, "insights", "status.jsonl"), qualityInsightStatusRecord{
		Tag:                 "QualityInsightStatus",
		InsightID:           "pattern-high-token-karyla-agent",
		Status:              "resolved",
		UpdatedAt:           resolvedAt,
		ResolvedAt:          resolvedAt,
		ResolvedOccurrences: 2,
	}); err != nil {
		t.Fatal(err)
	}
	if err := appendQualityJSONLine(filepath.Join(dir, "insights", "status.jsonl"), qualityInsightStatusRecord{
		Tag:                 "QualityInsightStatus",
		InsightID:           "high-token-usage-run-a",
		Status:              "resolved",
		UpdatedAt:           resolvedAt,
		ResolvedAt:          resolvedAt,
		ResolvedOccurrences: 2,
	}); err != nil {
		t.Fatal(err)
	}

	unchanged, err := buildQualityInsightsFromRuns(dir, []qualityRunRecord{
		{TraceID: "run-a", TargetID: "karyla-agent", Status: "success", StartedAt: time.Now().Add(-2 * time.Minute).UnixMilli(), TokenCount: 12000},
		{TraceID: "run-b", TargetID: "karyla-agent", Status: "success", StartedAt: time.Now().Add(-1 * time.Minute).UnixMilli(), TokenCount: 13000},
	})
	if err != nil {
		t.Fatal(err)
	}
	pattern := findQualityInsightByID(unchanged, "pattern-high-token-karyla-agent")
	if pattern == nil || pattern.Status != "resolved" || pattern.ReopenedAt != "" {
		t.Fatalf("pattern = %#v, want still resolved", pattern)
	}

	dropped, err := buildQualityInsightsFromRuns(dir, []qualityRunRecord{
		{TraceID: "run-a", TargetID: "karyla-agent", Status: "success", StartedAt: time.Now().UnixMilli(), TokenCount: 12000},
	})
	if err != nil {
		t.Fatal(err)
	}
	single := findQualityInsightByID(dropped, "high-token-usage-run-a")
	if single == nil || single.Status != "resolved" || single.ReopenedAt != "" {
		t.Fatalf("single = %#v, want still resolved after count drop", single)
	}
}

func TestServiceInsightsSilencePatterns(t *testing.T) {
	dir := t.TempDir()
	_, err := persistQualityInsightSilence(dir, qualityInsightSilenceRequest{
		Pattern: &qualityInsightSilencePattern{Title: "Run has high token usage", TargetID: "karyla-agent"},
	})
	if err != nil {
		t.Fatal(err)
	}
	insights, err := buildQualityInsightsFromRuns(dir, []qualityRunRecord{
		{TraceID: "run-a", TargetID: "karyla-agent", Status: "success", StartedAt: time.Now().UnixMilli(), TokenCount: 12000},
	})
	if err != nil {
		t.Fatal(err)
	}
	if findQualityInsightByID(insights, "high-token-usage-run-a") != nil {
		t.Fatalf("insights = %#v, want target-specific high-token insight silenced", insights)
	}
}

func TestServiceInsightsTitleOnlySilenceMatchesAllTargetsAndDeleteRestores(t *testing.T) {
	dir := t.TempDir()
	silence, err := persistQualityInsightSilence(dir, qualityInsightSilenceRequest{
		Pattern: &qualityInsightSilencePattern{Title: "Run has high token usage"},
	})
	if err != nil {
		t.Fatal(err)
	}
	runs := []qualityRunRecord{
		{TraceID: "run-a", TargetID: "karyla-agent", Status: "success", StartedAt: time.Now().UnixMilli(), TokenCount: 12000},
	}
	insights, err := buildQualityInsightsFromRuns(dir, runs)
	if err != nil {
		t.Fatal(err)
	}
	if findQualityInsightByID(insights, "high-token-usage-run-a") != nil {
		t.Fatalf("insights = %#v, want title-only silence to hide all targets", insights)
	}
	if _, err := deleteQualityInsightSilence(dir, silence.ID); err != nil {
		t.Fatal(err)
	}
	insights, err = buildQualityInsightsFromRuns(dir, runs)
	if err != nil {
		t.Fatal(err)
	}
	if findQualityInsightByID(insights, "high-token-usage-run-a") == nil {
		t.Fatalf("insights = %#v, want deleted silence to restore insight", insights)
	}
}

func TestBucketExperimentPassRatesUsesExplicitClock(t *testing.T) {
	now := time.Date(2026, 5, 25, 15, 45, 0, 0, time.UTC)
	experiments := []qualityExperimentRecord{
		{
			EndedAt: now.Add(-24 * time.Hour).Format(time.RFC3339Nano),
			Summary: struct {
				Total   int `json:"total"`
				Passed  int `json:"passed"`
				Failed  int `json:"failed"`
				Errored int `json:"errored"`
			}{
				Total:  4,
				Passed: 3,
			},
		},
		{
			EndedAt: now.Format(time.RFC3339Nano),
			Summary: struct {
				Total   int `json:"total"`
				Passed  int `json:"passed"`
				Failed  int `json:"failed"`
				Errored int `json:"errored"`
			}{
				Total:  2,
				Passed: 1,
			},
		},
	}

	got := bucketExperimentPassRatesAt(experiments, 3, 24*time.Hour, now)
	want := []float64{0, 0.75, 0.5}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("bucketExperimentPassRatesAt() = %#v, want %#v", got, want)
	}
}

func findQualityInsightByID(insights []qualityInsightRecord, id string) *qualityInsightRecord {
	for index := range insights {
		if insights[index].InsightID == id {
			return &insights[index]
		}
	}
	return nil
}

func joinJSONRecords(records []string) string {
	return strings.Join(records, ",")
}
