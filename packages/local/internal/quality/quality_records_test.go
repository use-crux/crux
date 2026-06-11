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

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/qualityfs"
	"github.com/use-crux/crux/packages/local/internal/store"
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
	if run.RootPrimitive != "generation.call" || run.Status != "ok" || run.SpanCount != 1 || run.ChildCount != 1 {
		t.Fatalf("run observability rollup = %#v", run)
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

func TestServiceRunsWithOptionsFiltersByRunRowRollups(t *testing.T) {
	ctx := context.Background()
	obs, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer obs.Close()

	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{"records":[
		{"schemaVersion":1,"recordId":"run-gen-start","type":"run:start","runId":"run_filter_generation","traceId":"trace_filter_generation","name":"support reply","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"span-gen","type":"span","runId":"run_filter_generation","traceId":"trace_filter_generation","spanId":"span_filter_generation","family":"generation","primitive":"generation.call","name":"support reply","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.100Z","durationMs":90,"status":"ok","model":"gpt-4o","provider":"openai","metrics":{"totalTokens":42}},
		{"schemaVersion":1,"recordId":"run-gen-end","type":"run:end","runId":"run_filter_generation","traceId":"trace_filter_generation","endedAt":"2026-05-16T18:00:00.120Z","durationMs":120,"status":"ok"},
		{"schemaVersion":1,"recordId":"run-ret-start","type":"run:start","runId":"run_filter_retrieval","traceId":"trace_filter_retrieval","name":"search docs","rootPrimitive":"retrieval.query","startedAt":"2026-05-16T18:01:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"span-ret","type":"span","runId":"run_filter_retrieval","traceId":"trace_filter_retrieval","spanId":"span_filter_retrieval","family":"retrieval","primitive":"retrieval.query","name":"search docs","startedAt":"2026-05-16T18:01:00.010Z","endedAt":"2026-05-16T18:01:00.100Z","durationMs":90,"status":"ok","model":"claude-3-5-sonnet","provider":"anthropic"},
		{"schemaVersion":1,"recordId":"run-ret-end","type":"run:end","runId":"run_filter_retrieval","traceId":"trace_filter_retrieval","endedAt":"2026-05-16T18:01:00.120Z","durationMs":120,"status":"ok"}
	]}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	traceID := "run_filter_generation"
	if err := qualityfs.AppendJSONLine(filepath.Join(dir, "feedback", "inbox.jsonl"), qualityFeedbackRecord{
		Tag:       "QualityFeedback",
		ID:        "feedback-filter-generation",
		QualityID: "local",
		CreatedAt: "2026-05-16T18:02:00.000Z",
		Status:    "new",
		TraceID:   &traceID,
	}); err != nil {
		t.Fatal(err)
	}
	if err := qualityfs.Open(dir).WriteRecord(qualityfs.KindExperiments, "experiment-filter-generation", qualityExperimentRecord{
		Tag:       "QualityExperiment",
		ID:        "experiment-filter-generation",
		QualityID: "local",
		StartedAt: "2026-05-16T18:02:00.000Z",
		EndedAt:   "2026-05-16T18:03:00.000Z",
		Status:    "completed",
		Cases: []qualityExperimentCase{{
			CaseID:    "case-1",
			VariantID: "candidate",
			Status:    "passed",
			TraceID:   "run_filter_generation",
		}},
	}); err != nil {
		t.Fatal(err)
	}

	service := NewService(store.NewStore(), dir).WithObservability(obs)
	byKind, err := service.RunsWithOptions(ctx, api.QualityRunsOptions{Kind: []string{"generation"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(byKind) != 1 || byKind[0].TraceID != "run_filter_generation" {
		t.Fatalf("kind filtered runs = %#v, want generation run", byKind)
	}

	byModel, err := service.RunsWithOptions(ctx, api.QualityRunsOptions{Model: []string{"claude-3-5-sonnet"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(byModel) != 1 || byModel[0].TraceID != "run_filter_retrieval" {
		t.Fatalf("model filtered runs = %#v, want retrieval run", byModel)
	}

	withFeedback, err := service.RunsWithOptions(ctx, api.QualityRunsOptions{Has: []string{"feedback"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(withFeedback) != 1 || withFeedback[0].FeedbackCount != 1 || withFeedback[0].TraceID != "run_filter_generation" {
		t.Fatalf("feedback filtered runs = %#v, want feedback-linked generation run", withFeedback)
	}

	withExperiment, err := service.RunsWithOptions(ctx, api.QualityRunsOptions{Has: []string{"experiment"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(withExperiment) != 1 || !containsString(withExperiment[0].ExperimentIDs, "experiment-filter-generation") || withExperiment[0].TraceID != "run_filter_generation" {
		t.Fatalf("experiment filtered runs = %#v, want experiment-linked generation run", withExperiment)
	}
}

func TestServiceOverviewIncludesRunTabCounts(t *testing.T) {
	ctx := context.Background()
	obs, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer obs.Close()

	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{"records":[
		{"schemaVersion":1,"recordId":"run-counts-ok-start","type":"run:start","runId":"run_counts_ok","traceId":"trace_counts_ok","name":"ok run","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"run-counts-ok-end","type":"run:end","runId":"run_counts_ok","traceId":"trace_counts_ok","endedAt":"2026-05-16T18:00:00.120Z","durationMs":120,"status":"ok"},
		{"schemaVersion":1,"recordId":"run-counts-live-start","type":"run:start","runId":"run_counts_live","traceId":"trace_counts_live","name":"live run","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:01:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"run-counts-error-start","type":"run:start","runId":"run_counts_error","traceId":"trace_counts_error","name":"error run","rootPrimitive":"tool.call","startedAt":"2026-05-16T18:02:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"run-counts-error-end","type":"run:end","runId":"run_counts_error","traceId":"trace_counts_error","endedAt":"2026-05-16T18:02:00.120Z","durationMs":120,"status":"error","error":{"message":"tool failed"}}
	]}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	traceID := "run_counts_ok"
	if err := qualityfs.AppendJSONLine(filepath.Join(dir, "feedback", "inbox.jsonl"), qualityFeedbackRecord{
		Tag:       "QualityFeedback",
		ID:        "feedback-counts-ok",
		QualityID: "local",
		CreatedAt: "2026-05-16T18:03:00.000Z",
		Status:    "new",
		TraceID:   &traceID,
	}); err != nil {
		t.Fatal(err)
	}

	service := NewService(store.NewStore(), dir).WithObservability(obs)
	overview, err := service.Overview(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if overview.RunTabCounts.All != 3 || overview.RunTabCounts.Live != 1 || overview.RunTabCounts.Failures != 1 || overview.RunTabCounts.HasFeedback != 1 {
		t.Fatalf("run tab counts = %#v, want all/live/failures/has-feedback = 3/1/1/1", overview.RunTabCounts)
	}
}

func TestServiceRunsRowIncludesErrorPreviewAndDiagnosticSeverity(t *testing.T) {
	ctx := context.Background()
	obs, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer obs.Close()

	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{"records":[
		{"schemaVersion":1,"recordId":"run-error-start","type":"run:start","runId":"run_error_rollup","traceId":"trace_error_rollup","name":"error rollup","rootPrimitive":"tool.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"span-error","type":"span","runId":"run_error_rollup","traceId":"trace_error_rollup","spanId":"span_error_rollup","family":"tool","primitive":"tool.call","name":"searchDocs","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.100Z","durationMs":90,"status":"error","attributes":{"diagnosticCode":"tool-contract-mismatch","diagnosticSeverity":"error"},"error":{"message":"tool contract mismatch"}},
		{"schemaVersion":1,"recordId":"run-error-end","type":"run:end","runId":"run_error_rollup","traceId":"trace_error_rollup","endedAt":"2026-05-16T18:00:00.120Z","durationMs":120,"status":"error","error":{"message":"tool contract mismatch"}}
	]}`), &batch); err != nil {
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
	errPreview, ok := run.Error.(map[string]any)
	if !ok || errPreview["message"] != "tool contract mismatch" {
		t.Fatalf("run error preview = %#v", run.Error)
	}
	if run.DiagnosticCount != 1 || run.DiagnosticMaxSeverity != "error" || !containsString(run.DiagnosticCodes, "tool-contract-mismatch") {
		t.Fatalf("run diagnostics = count:%d severity:%q codes:%#v", run.DiagnosticCount, run.DiagnosticMaxSeverity, run.DiagnosticCodes)
	}
}

func TestServiceRunDetailNarrativeIncludesArtifactContent(t *testing.T) {
	ctx := context.Background()
	obs, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer obs.Close()

	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{"records":[
		{"schemaVersion":1,"recordId":"run-story-start","type":"run:start","runId":"run_story_content","traceId":"trace_story_content","name":"story content","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"agent-story","type":"span","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_agent","family":"agent","primitive":"agent.run","name":"support agent","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:01.000Z","durationMs":990,"status":"ok","metrics":{"totalTokens":123,"costUsd":0.0042}},
		{"schemaVersion":1,"recordId":"tool-story","type":"span","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_tool","parentSpanId":"span_story_agent","family":"tool","primitive":"tool.call","name":"searchDocs","startedAt":"2026-05-16T18:00:00.100Z","endedAt":"2026-05-16T18:00:00.200Z","durationMs":100,"status":"ok","toolName":"searchDocs"},
		{"schemaVersion":1,"recordId":"artifact-tool-args","type":"artifact","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_tool","artifactId":"artifact_tool_args","kind":"tool.args","createdAt":"2026-05-16T18:00:00.110Z","contentType":"application/json","encoding":"json","preview":{"query":"refund policy"},"attributes":{"toolName":"searchDocs"}},
		{"schemaVersion":1,"recordId":"artifact-tool-result","type":"artifact","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_tool","artifactId":"artifact_tool_result","kind":"tool.result","createdAt":"2026-05-16T18:00:00.190Z","contentType":"application/json","encoding":"json","preview":{"answer":"Refunds are available for 30 days."},"attributes":{"toolName":"searchDocs"}},
		{"schemaVersion":1,"recordId":"retrieval-story","type":"span","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_retrieval","parentSpanId":"span_story_agent","family":"retrieval","primitive":"retrieval.query","name":"retrieve docs","startedAt":"2026-05-16T18:00:00.300Z","endedAt":"2026-05-16T18:00:00.400Z","durationMs":100,"status":"ok"},
		{"schemaVersion":1,"recordId":"artifact-retrieval-hits","type":"artifact","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_retrieval","artifactId":"artifact_retrieval_hits","kind":"retrieval.hits","createdAt":"2026-05-16T18:00:00.390Z","contentType":"application/json","encoding":"json","preview":{"query":"refund policy","hits":[{"sourceId":"refunds.md","chunkId":"refunds#1","score":0.91,"preview":"Refunds are available for 30 days."}],"returned":1}},
		{"schemaVersion":1,"recordId":"score-story","type":"span","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_score","parentSpanId":"span_story_agent","family":"scoring","primitive":"scoring.judge","name":"citation judge","startedAt":"2026-05-16T18:00:00.500Z","endedAt":"2026-05-16T18:00:00.600Z","durationMs":100,"status":"ok"},
		{"schemaVersion":1,"recordId":"artifact-score-report","type":"artifact","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_score","artifactId":"artifact_score_report","kind":"score.report","createdAt":"2026-05-16T18:00:00.590Z","contentType":"application/json","encoding":"json","preview":{"verdict":"fail","rationale":"Missing citation for refund policy.","judges":[{"name":"citation judge","score":0.4,"threshold":0.8,"status":"failed","rationale":"No marker in the answer."}]}},
		{"schemaVersion":1,"recordId":"citation-story","type":"span","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_citation","parentSpanId":"span_story_agent","family":"citation","primitive":"citation.check","name":"citation check","startedAt":"2026-05-16T18:00:00.610Z","endedAt":"2026-05-16T18:00:00.700Z","durationMs":90,"status":"ok"},
		{"schemaVersion":1,"recordId":"artifact-citation-report","type":"artifact","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_citation","artifactId":"artifact_citation_report","kind":"citation.report","createdAt":"2026-05-16T18:00:00.690Z","contentType":"application/json","encoding":"json","preview":{"markers":[{"marker":"[1]","sourceId":"refunds.md","chunkId":"refunds#1","score":0.95,"grounded":true}]}},
		{"schemaVersion":1,"recordId":"memory-story","type":"span","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_memory","parentSpanId":"span_story_agent","family":"memory","primitive":"memory.write","name":"memory write","startedAt":"2026-05-16T18:00:00.710Z","endedAt":"2026-05-16T18:00:00.800Z","durationMs":90,"status":"ok"},
		{"schemaVersion":1,"recordId":"artifact-memory-snapshot","type":"artifact","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_memory","artifactId":"artifact_memory_snapshot","kind":"memory.snapshot","createdAt":"2026-05-16T18:00:00.790Z","contentType":"application/json","encoding":"json","preview":{"memoryType":"working","blocks":[{"key":"refund-policy","preview":"Refunds are available for 30 days.","score":0.8}],"mode":"auto","status":"written"}},
		{"schemaVersion":1,"recordId":"artifact-output","type":"artifact","runId":"run_story_content","traceId":"trace_story_content","spanId":"span_story_agent","artifactId":"artifact_output","kind":"output","createdAt":"2026-05-16T18:00:00.990Z","contentType":"application/json","encoding":"json","preview":{"text":"You can request a refund within 30 days."}},
		{"schemaVersion":1,"recordId":"run-story-end","type":"run:end","runId":"run_story_content","traceId":"trace_story_content","endedAt":"2026-05-16T18:00:01.000Z","durationMs":1000,"status":"ok"}
	]}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	service := NewService(store.NewStore(), t.TempDir()).WithObservability(obs)
	detail, found, err := service.RunDetail(ctx, "run_story_content")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("detail not found")
	}

	tool := findNarrativeEventByID(detail.Narrative, "artifact_tool_result")
	if tool == nil || tool.Kind != "tool" || tool.Data["actor"] != "searchDocs" {
		t.Fatalf("tool narrative = %#v", tool)
	}
	if body, ok := tool.Data["body"].(map[string]any); !ok || body["answer"] != "Refunds are available for 30 days." {
		t.Fatalf("tool body = %#v", tool.Data["body"])
	}
	toolArgs := findNarrativeEventByID(detail.Narrative, "artifact_tool_args")
	if toolArgs == nil || toolArgs.Kind != "tool" || toolArgs.Data["actor"] != "searchDocs" {
		t.Fatalf("tool args narrative = %#v", toolArgs)
	}
	retrieval := findNarrativeEventByID(detail.Narrative, "artifact_retrieval_hits")
	if retrieval == nil || retrieval.Kind != "retrieval" || retrieval.Data["detail"] != "1 hit" {
		t.Fatalf("retrieval narrative = %#v", retrieval)
	}
	score := findNarrativeEventByID(detail.Narrative, "artifact_score_report")
	if score == nil || score.Kind != "score" || score.Data["detail"] != "Missing citation for refund policy." {
		t.Fatalf("score narrative = %#v", score)
	}
	citation := findNarrativeEventByID(detail.Narrative, "artifact_citation_report")
	if citation == nil || citation.Kind != "citation" || citation.Data["detail"] != "1 marker" {
		t.Fatalf("citation narrative = %#v", citation)
	}
	memory := findNarrativeEventByID(detail.Narrative, "artifact_memory_snapshot")
	if memory == nil || memory.Kind != "memory" || memory.Data["detail"] != "working | 1 block" {
		t.Fatalf("memory narrative = %#v", memory)
	}
	output := findNarrativeEventByID(detail.Narrative, "artifact_output")
	if output == nil || output.Kind != "output" || output.Data["text"] != "You can request a refund within 30 days." {
		t.Fatalf("output narrative = %#v", output)
	}
	if meta, ok := output.Data["meta"].(string); !ok || !strings.Contains(meta, "123 tokens") || !strings.Contains(meta, "$0.0042") {
		t.Fatalf("output meta = %#v", output.Data["meta"])
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
	if err := qualityfs.AppendJSONLine(filepath.Join(dir, "insights", "status.jsonl"), qualityInsightStatusRecord{
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
	if err := qualityfs.AppendJSONLine(filepath.Join(dir, "insights", "status.jsonl"), qualityInsightStatusRecord{
		Tag:                 "QualityInsightStatus",
		InsightID:           "pattern-high-token-karyla-agent",
		Status:              "resolved",
		UpdatedAt:           resolvedAt,
		ResolvedAt:          resolvedAt,
		ResolvedOccurrences: 2,
	}); err != nil {
		t.Fatal(err)
	}
	if err := qualityfs.AppendJSONLine(filepath.Join(dir, "insights", "status.jsonl"), qualityInsightStatusRecord{
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

func findNarrativeEventByID(events []qualityRunNarrativeEvent, id string) *qualityRunNarrativeEvent {
	for index := range events {
		if events[index].ID == id {
			return &events[index]
		}
	}
	return nil
}

func joinJSONRecords(records []string) string {
	return strings.Join(records, ",")
}
