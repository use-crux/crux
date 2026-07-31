package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestServiceIngestsSharedFixtureIntoGraphReadModel(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := loadGenerationFixture(t)
	runID := generationFixtureRunID(t, batch)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	run, err := service.Run(ctx, runID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Name != "support reply" {
		t.Fatalf("run name = %q", run.Name)
	}
	if run.Status != "ok" {
		t.Fatalf("run status = %q, want ok", run.Status)
	}
	if run.Model != "gpt-4o" || run.Provider != "openai" || run.PromptID != "support.reply" {
		t.Fatalf("run summary identity = model:%q provider:%q prompt:%q", run.Model, run.Provider, run.PromptID)
	}
	var runMetrics map[string]any
	if err := json.Unmarshal(run.Metrics, &runMetrics); err != nil {
		t.Fatalf("run metrics should be inspectable JSON: %v", err)
	}
	if runMetrics["totalTokens"] != float64(60) || runMetrics["costUsd"] != 0.00042 {
		t.Fatalf("run metrics = %#v, want token and cost totals", runMetrics)
	}
	if run.SpanCount != 1 || run.EventCount != 1 || run.ArtifactCount != 4 || run.EdgeCount != 4 {
		t.Fatalf("counts = spans:%d events:%d artifacts:%d edges:%d", run.SpanCount, run.EventCount, run.ArtifactCount, run.EdgeCount)
	}

	graph, err := service.Graph(ctx, runID)
	if err != nil {
		t.Fatal(err)
	}
	if len(graph.Spans) != 1 {
		t.Fatalf("span count = %d, want 1", len(graph.Spans))
	}
	if graph.Run.RecordCount != len(batch.Records) || graph.Run.SpanCount != 1 || graph.Run.EventCount != 1 || graph.Run.ArtifactCount != 4 || graph.Run.EdgeCount != 4 {
		t.Fatalf("graph run counts = records:%d spans:%d events:%d artifacts:%d edges:%d", graph.Run.RecordCount, graph.Run.SpanCount, graph.Run.EventCount, graph.Run.ArtifactCount, graph.Run.EdgeCount)
	}
	span := graph.Spans[0]
	if span.Primitive != "generation.call" || span.Status != "ok" {
		t.Fatalf("span primitive/status = %q/%q", span.Primitive, span.Status)
	}
	if span.PromptID != "support.reply" || span.Model != "gpt-4o" || span.Provider != "openai" {
		t.Fatalf("span identity fields = prompt:%q model:%q provider:%q", span.PromptID, span.Model, span.Provider)
	}
	var spanAttrs map[string]any
	if err := json.Unmarshal(span.Attributes, &spanAttrs); err != nil {
		t.Fatalf("span attributes should be inspectable JSON: %v", err)
	}
	if spanAttrs["finishReason"] != "stop" {
		t.Fatalf("span attributes = %#v, want finishReason", spanAttrs)
	}
	var spanMetrics map[string]any
	if err := json.Unmarshal(span.Metrics, &spanMetrics); err != nil {
		t.Fatalf("span metrics should be inspectable JSON: %v", err)
	}
	if spanMetrics["totalTokens"] != float64(60) {
		t.Fatalf("span metrics = %#v, want totalTokens", spanMetrics)
	}
	if len(graph.Events) != 1 || graph.Events[0].Name != "usage.observed" {
		t.Fatalf("events = %#v", graph.Events)
	}
	var eventAttrs map[string]any
	if err := json.Unmarshal(graph.Events[0].Attributes, &eventAttrs); err != nil {
		t.Fatalf("span event attributes should be inspectable JSON: %v", err)
	}
	if eventAttrs["inputTokens"] != float64(42) {
		t.Fatalf("event attributes = %#v, want inputTokens", eventAttrs)
	}
	if len(graph.Artifacts) != 4 {
		t.Fatalf("artifact count = %d, want 4", len(graph.Artifacts))
	}
	var inputPreview map[string]any
	if err := json.Unmarshal(graph.Artifacts[0].Preview, &inputPreview); err != nil {
		t.Fatalf("artifact preview should be inspectable JSON: %v", err)
	}
	if _, ok := inputPreview["messages"]; !ok {
		t.Fatalf("artifact preview = %#v, want messages", inputPreview)
	}
	if len(graph.Edges) != 4 {
		t.Fatalf("edge count = %d, want 4", len(graph.Edges))
	}
	if len(graph.Records) != len(batch.Records) {
		t.Fatalf("stored records = %d, want %d", len(graph.Records), len(batch.Records))
	}
	if graph.Records[0].PayloadJSON == "" {
		t.Fatal("stored records should preserve full payload JSON for inspection")
	}
	if graph.Edges[0].From.Kind != "span" || graph.Edges[0].To.Kind != "artifact" {
		t.Fatalf("edge refs = %#v -> %#v", graph.Edges[0].From, graph.Edges[0].To)
	}

	runs, err := service.Runs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].RunID != runID {
		t.Fatalf("runs = %#v", runs)
	}
	if runs[0].PromptID != "support.reply" || len(runs[0].Metrics) == 0 {
		t.Fatalf("run list summary missing detail fields: %#v", runs[0])
	}
}

func TestServiceReadsRunGraphAndDetailByOperationID(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_trace_alias","segmentId":"seg_trace_alias_a","segmentSeq":1,"traceId":"trace_trace_alias","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_trace_alias","segmentId":"seg_trace_alias_a","segmentSeq":2,"traceId":"trace_trace_alias","spanId":"span_agent","family":"agent","primitive":"agent.run","name":"Support Agent streamText","startedAt":"2026-05-16T18:00:00.010Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent_end","type":"span:end","runId":"run_trace_alias","segmentId":"seg_trace_alias_a","segmentSeq":3,"traceId":"trace_trace_alias","spanId":"span_agent","endedAt":"2026-05-16T18:00:01.000Z","durationMs":990,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_trace_alias","segmentId":"seg_trace_alias_a","segmentSeq":4,"traceId":"trace_trace_alias","endedAt":"2026-05-16T18:00:01.010Z","durationMs":1010,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	run, err := service.Run(ctx, "run_trace_alias")
	if err != nil {
		t.Fatal(err)
	}
	if run.RunID != "run_trace_alias" || run.TraceID != "trace_trace_alias" {
		t.Fatalf("run = %#v", run)
	}

	graph, err := service.Graph(ctx, "run_trace_alias")
	if err != nil {
		t.Fatal(err)
	}
	if graph.Run.RunID != "run_trace_alias" || len(graph.Spans) != 1 {
		t.Fatalf("graph = %#v", graph)
	}

	detail, err := service.RunDetail(ctx, "run_trace_alias")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Run.RunID != "run_trace_alias" || detail.Run.TraceID != "trace_trace_alias" {
		t.Fatalf("detail run = %#v", detail.Run)
	}
}

func TestServiceRunDetailDiagnosticsIncludeSuggestedFixes(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_diagnostic_fix","segmentId":"seg_diagnostic_fix_a","segmentSeq":1,"traceId":"trace_diagnostic_fix","name":"diagnostic fix","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_span","type":"span","runId":"run_diagnostic_fix","segmentId":"seg_diagnostic_fix_a","segmentSeq":2,"traceId":"trace_diagnostic_fix","spanId":"span_orphan","parentSpanId":"span_missing","family":"tool","primitive":"tool.call","name":"orphan tool","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.020Z","durationMs":10,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_diagnostic_fix","segmentId":"seg_diagnostic_fix_a","segmentSeq":3,"traceId":"trace_diagnostic_fix","endedAt":"2026-05-16T18:00:00.030Z","durationMs":30,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_diagnostic_fix")
	if err != nil {
		t.Fatal(err)
	}
	var missingParent *RunDetailDiagnostic
	for index := range detail.Diagnostics {
		if detail.Diagnostics[index].Code == "missing-parent-span" {
			missingParent = &detail.Diagnostics[index]
			break
		}
	}
	if missingParent == nil {
		t.Fatalf("diagnostics = %#v, want missing-parent-span", detail.Diagnostics)
	}
	if !slices.Equal(missingParent.SpanIDs, []string{"span_orphan", "span_missing"}) || missingParent.SuggestedFix == "" {
		t.Fatalf("missing parent diagnostic = %#v, want span ids [span_orphan span_missing] and suggested fix", *missingParent)
	}
}

func TestServiceRunDetailPromotesErrorsIntoInspection(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_error_inspection","segmentId":"seg_error_inspection_a","segmentSeq":1,"traceId":"trace_error_inspection","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_tool_start","type":"span:start","runId":"run_error_inspection","segmentId":"seg_error_inspection_a","segmentSeq":2,"traceId":"trace_error_inspection","spanId":"span_tool","family":"tool","primitive":"tool.call","name":"search","startedAt":"2026-05-16T18:00:00.010Z","status":"running","attributes":{"toolName":"search","toolCallId":"call_search"}}`,
		`{"schemaVersion":2,"recordId":"rec_exception","type":"span:event","runId":"run_error_inspection","segmentId":"seg_error_inspection_a","segmentSeq":3,"traceId":"trace_error_inspection","spanId":"span_tool","eventId":"event_exception","name":"exception","timestamp":"2026-05-16T18:00:00.020Z","attributes":{"exception.message":"execute failed","exception.type":"Error","exception.stacktrace":"Error: execute failed\n    at search","error.phase":"tool.execute","error.kind":"execute_error"}}`,
		`{"schemaVersion":2,"recordId":"rec_error_stack","type":"artifact","runId":"run_error_inspection","segmentId":"seg_error_inspection_a","segmentSeq":4,"traceId":"trace_error_inspection","spanId":"span_tool","artifactId":"artifact_error_stack","kind":"error.stack","createdAt":"2026-05-16T18:00:00.021Z","contentType":"text/plain","encoding":"text","preview":"Error: execute failed\n    at search","attributes":{"toolName":"search","toolCallId":"call_search"}}`,
		`{"schemaVersion":2,"recordId":"rec_error_raw","type":"artifact","runId":"run_error_inspection","segmentId":"seg_error_inspection_a","segmentSeq":5,"traceId":"trace_error_inspection","spanId":"span_tool","artifactId":"artifact_error_raw","kind":"error.raw","createdAt":"2026-05-16T18:00:00.022Z","contentType":"application/json","encoding":"json","preview":{"message":"execute failed","name":"Error","token":"[redacted]"},"attributes":{"toolName":"search","toolCallId":"call_search"}}`,
		`{"schemaVersion":2,"recordId":"rec_tool_end","type":"span:end","runId":"run_error_inspection","segmentId":"seg_error_inspection_a","segmentSeq":6,"traceId":"trace_error_inspection","spanId":"span_tool","endedAt":"2026-05-16T18:00:00.030Z","durationMs":20,"status":"error","error":{"message":"execute failed","name":"Error","category":"execute_error"},"attributes":{"toolName":"search","toolCallId":"call_search","phase":"tool.execute","errorKind":"execute_error"}}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_error_inspection","segmentId":"seg_error_inspection_a","segmentSeq":7,"traceId":"trace_error_inspection","endedAt":"2026-05-16T18:00:00.040Z","durationMs":40,"status":"error","error":{"message":"execute failed","name":"Error"}}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_error_inspection")
	if err != nil {
		t.Fatal(err)
	}
	tool := findRunDetailNode(&detail.Root, "span_tool")
	if tool == nil {
		t.Fatalf("tool node not found in detail: %#v", detail.Root)
	}
	errorsSection := tool.Inspection["errors"]
	if got, want := len(errorsSection), 3; got != want {
		t.Fatalf("errors inspection len = %d, want %d: %#v", got, want, tool.Inspection)
	}
	if errorsSection[0].Type != "span.error" || errorsSection[0].ID != "error:span_tool" {
		t.Fatalf("span error item = %#v", errorsSection[0])
	}
	var spanError map[string]any
	if err := json.Unmarshal(errorsSection[0].Data, &spanError); err != nil {
		t.Fatalf("span error data should be JSON: %v", err)
	}
	if spanError["message"] != "execute failed" || spanError["category"] != "execute_error" {
		t.Fatalf("span error data = %#v", spanError)
	}
	if errorsSection[1].Kind != "error.stack" || !strings.Contains(string(errorsSection[1].Data), "execute failed") {
		t.Fatalf("stack error item = %#v", errorsSection[1])
	}
	if errorsSection[2].Kind != "error.raw" || !strings.Contains(string(errorsSection[2].Data), "[redacted]") {
		t.Fatalf("raw error item = %#v", errorsSection[2])
	}
}

func TestServiceRunsRollUpSpanMetricsAndIdentity(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_list_rollup","segmentId":"seg_list_rollup_a","segmentSeq":1,"traceId":"trace_list_rollup","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_list_rollup","segmentId":"seg_list_rollup_a","segmentSeq":2,"traceId":"trace_list_rollup","spanId":"span_generate","family":"generation","primitive":"generation.stream","name":"stream Support Agent","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:01.010Z","durationMs":1000,"status":"ok","attributes":{"model":"google/gemini-3.1-flash-lite-preview","provider":"openrouter","promptId":"chat.answer"},"metrics":{"inputTokens":10,"outputTokens":12,"totalTokens":22,"costUsd":0.02}}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_list_rollup","segmentId":"seg_list_rollup_a","segmentSeq":3,"traceId":"trace_list_rollup","endedAt":"2026-05-16T18:00:01.020Z","durationMs":1020,"status":"ok"}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	runs, err := service.Runs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 {
		t.Fatalf("runs = %#v", runs)
	}
	run := runs[0]
	if run.Model != "google/gemini-3.1-flash-lite-preview" || run.Provider != "openrouter" || run.PromptID != "chat.answer" {
		t.Fatalf("run identity = model:%q provider:%q prompt:%q", run.Model, run.Provider, run.PromptID)
	}
	var metrics map[string]float64
	if err := json.Unmarshal(run.Metrics, &metrics); err != nil {
		t.Fatalf("run metrics should be inspectable JSON: %v", err)
	}
	if metrics["totalTokens"] != 22 || metrics["costUsd"] != 0.02 {
		t.Fatalf("run metrics = %#v, want rolled up span usage", metrics)
	}

	detail, err := service.Run(ctx, "run_list_rollup")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Model != run.Model || detail.Provider != run.Provider || detail.PromptID != run.PromptID {
		t.Fatalf("detail identity = %#v, want list identity %#v", detail, run)
	}
}

func TestServiceRunsWithOptionsLimitsBeforeRollups(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	records := []string{}
	for i := 0; i < 3; i++ {
		runID := fmt.Sprintf("run_page_%d", i)
		segmentID := fmt.Sprintf("seg_page_%d_a", i)
		traceID := fmt.Sprintf("trace_page_%d", i)
		spanID := fmt.Sprintf("span_page_%d", i)
		started := fmt.Sprintf("2026-05-16T18:0%d:00.000Z", i)
		ended := fmt.Sprintf("2026-05-16T18:0%d:01.000Z", i)
		records = append(records,
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"%s-start","type":"run:start","runId":%q,"segmentId":%q,"segmentSeq":1,"traceId":%q,"name":"paged","rootPrimitive":"agent.run","startedAt":%q,"status":"running"}`, runID, runID, segmentID, traceID, started),
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"%s-span","type":"span","runId":%q,"segmentId":%q,"segmentSeq":2,"traceId":%q,"spanId":%q,"family":"generation","primitive":"generation.stream","name":"stream","startedAt":%q,"endedAt":%q,"durationMs":1000,"status":"ok","attributes":{"model":"model-%d","provider":"openrouter","promptId":"prompt-%d"},"metrics":{"totalTokens":%d}}`, runID, runID, segmentID, traceID, spanID, started, ended, i, i, 10+i),
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"%s-end","type":"run:end","runId":%q,"segmentId":%q,"segmentSeq":3,"traceId":%q,"endedAt":%q,"durationMs":1000,"status":"ok"}`, runID, runID, segmentID, traceID, ended),
		)
	}
	if err := service.Ingest(ctx, mustBatch(t, records...)); err != nil {
		t.Fatal(err)
	}

	runs, err := service.RunsWithOptions(ctx, RunListOptions{Limit: 2, IncludeExpensiveRollups: true})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(runs), 2; got != want {
		t.Fatalf("runs len = %d, want %d", got, want)
	}
	if runs[0].RunID != "run_page_2" || runs[1].RunID != "run_page_1" {
		t.Fatalf("runs order = %#v", runs)
	}
	if runs[0].Model != "model-2" || runs[0].PromptID != "prompt-2" {
		t.Fatalf("limited run was not enriched: %#v", runs[0])
	}
}

func TestServiceRunsWithOptionsFiltersBySessionID(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"session-a-start","type":"run:start","runId":"run_session_a","segmentId":"seg_session_a_a","segmentSeq":1,"traceId":"trace_session_a","sessionId":"session-a","userId":"user-a","name":"session a","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"session-b-start","type":"run:start","runId":"run_session_b","segmentId":"seg_session_b_a","segmentSeq":1,"traceId":"trace_session_b","sessionId":"session-b","userId":"user-b","name":"session b","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:01:00.000Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}

	runs, err := service.RunsWithOptions(ctx, RunListOptions{SessionID: "session-a"})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(runs), 1; got != want {
		t.Fatalf("runs len = %d, want %d: %#v", got, want, runs)
	}
	if runs[0].RunID != "run_session_a" || runs[0].SessionID != "session-a" || runs[0].UserID != "user-a" {
		t.Fatalf("filtered run = %#v", runs[0])
	}

	allRuns, err := service.RunsWithOptions(ctx, RunListOptions{Limit: -1})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(allRuns), 2; got != want {
		t.Fatalf("all runs len = %d, want %d", got, want)
	}
}

func TestRunSignalsForRunsRestrictsRollupToSelectedRuns(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"selected-start","type":"run:start","runId":"run_selected","segmentId":"seg_selected_a","segmentSeq":1,"traceId":"trace_selected","name":"selected","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"selected-tool","type":"span","runId":"run_selected","segmentId":"seg_selected_a","segmentSeq":2,"traceId":"trace_selected","spanId":"span_selected_tool","family":"tool","primitive":"tool.call","name":"search","toolName":"search","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.020Z","durationMs":10,"status":"error"}`,
		`{"schemaVersion":2,"recordId":"selected-end","type":"run:end","runId":"run_selected","segmentId":"seg_selected_a","segmentSeq":3,"traceId":"trace_selected","endedAt":"2026-05-16T18:00:01.000Z","durationMs":1000,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"other-start","type":"run:start","runId":"run_other","segmentId":"seg_other_a","segmentSeq":1,"traceId":"trace_other","name":"other","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:01:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"other-tool","type":"span","runId":"run_other","segmentId":"seg_other_a","segmentSeq":2,"traceId":"trace_other","spanId":"span_other_tool","family":"tool","primitive":"tool.call","name":"fetch","toolName":"fetch","startedAt":"2026-05-16T18:01:00.010Z","endedAt":"2026-05-16T18:01:00.020Z","durationMs":10,"status":"error"}`,
		`{"schemaVersion":2,"recordId":"other-end","type":"run:end","runId":"run_other","segmentId":"seg_other_a","segmentSeq":3,"traceId":"trace_other","endedAt":"2026-05-16T18:01:01.000Z","durationMs":1000,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	signals, err := service.RunSignalsForRuns(ctx, []string{"run_selected"})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(signals), 1; got != want {
		t.Fatalf("signals len = %d, want %d: %#v", got, want, signals)
	}
	selected := signals["run_selected"]
	if selected.ToolCallCount != 1 || selected.ToolErrorCount != 1 || selected.RepeatedToolName != "search" {
		t.Fatalf("selected signals = %#v", selected)
	}
	if _, ok := signals["run_other"]; ok {
		t.Fatalf("unrequested run leaked into signals: %#v", signals)
	}
}

func TestRunSignalsForOperationsIncludesChildRuns(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":5,"recordId":"operation-signal-root","type":"run:start","runId":"run_signal_operation","operationId":"run_signal_operation","segmentId":"seg_signal_root","segmentSeq":1,"traceId":"trace_signal_operation","name":"root","rootPrimitive":"agent.run","startedAt":"2026-07-20T12:00:00Z","status":"running"}`,
		`{"schemaVersion":5,"recordId":"operation-signal-child","type":"run:start","runId":"run_signal_child","operationId":"run_signal_operation","parentRunId":"run_signal_operation","triggeredBySpanId":"span_signal_trigger","segmentId":"seg_signal_child","segmentSeq":1,"traceId":"trace_signal_operation","name":"child","rootPrimitive":"flow.run","startedAt":"2026-07-20T12:00:01Z","status":"running"}`,
		`{"schemaVersion":5,"recordId":"operation-signal-tool","type":"span","runId":"run_signal_child","operationId":"run_signal_operation","segmentId":"seg_signal_child","segmentSeq":2,"traceId":"trace_signal_operation","spanId":"span_signal_tool","family":"tool","primitive":"tool.call","name":"search","toolName":"search","startedAt":"2026-07-20T12:00:01Z","endedAt":"2026-07-20T12:00:02Z","status":"error"}`,
	)); err != nil {
		t.Fatal(err)
	}

	signals, err := service.RunSignalsForOperations(ctx, []string{"run_signal_operation"})
	if err != nil {
		t.Fatal(err)
	}
	operation := signals["run_signal_operation"]
	if operation.ToolCallCount != 1 || operation.ToolErrorCount != 1 || operation.RepeatedToolName != "search" {
		t.Fatalf("operation signals = %#v", operation)
	}
}

func TestRunSignalsForOperationsAggregatesRepeatedToolsDeterministically(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	records := []string{
		`{"schemaVersion":5,"recordId":"repeat-root","type":"run:start","runId":"run_repeat_operation","operationId":"run_repeat_operation","segmentId":"seg_repeat_root","segmentSeq":1,"name":"root","rootPrimitive":"agent.run","startedAt":"2026-07-20T12:10:00Z","status":"running"}`,
		`{"schemaVersion":5,"recordId":"repeat-child-a","type":"run:start","runId":"run_repeat_child_a","operationId":"run_repeat_operation","parentRunId":"run_repeat_operation","triggeredBySpanId":"repeat-trigger-a","segmentId":"seg_repeat_a","segmentSeq":1,"name":"a","rootPrimitive":"flow.run","startedAt":"2026-07-20T12:10:01Z","status":"running"}`,
		`{"schemaVersion":5,"recordId":"repeat-child-b","type":"run:start","runId":"run_repeat_child_b","operationId":"run_repeat_operation","parentRunId":"run_repeat_operation","triggeredBySpanId":"repeat-trigger-b","segmentId":"seg_repeat_b","segmentSeq":1,"name":"b","rootPrimitive":"flow.run","startedAt":"2026-07-20T12:10:02Z","status":"running"}`,
	}
	for index := 0; index < 3; index++ {
		records = append(records, fmt.Sprintf(`{"schemaVersion":5,"recordId":"repeat-root-search-%d","type":"span","runId":"run_repeat_operation","operationId":"run_repeat_operation","segmentId":"seg_repeat_root","segmentSeq":%d,"spanId":"repeat-root-search-%d","family":"tool","primitive":"tool.call","name":"search","toolName":"search","startedAt":"2026-07-20T12:10:03Z","endedAt":"2026-07-20T12:10:04Z","status":"ok"}`, index, index+2, index))
		records = append(records, fmt.Sprintf(`{"schemaVersion":5,"recordId":"repeat-child-search-%d","type":"span","runId":"run_repeat_child_b","operationId":"run_repeat_operation","segmentId":"seg_repeat_b","segmentSeq":%d,"spanId":"repeat-child-search-%d","family":"tool","primitive":"tool.call","name":"search","toolName":"search","startedAt":"2026-07-20T12:10:03Z","endedAt":"2026-07-20T12:10:04Z","status":"ok"}`, index, index+2, index))
	}
	for index := 0; index < 4; index++ {
		records = append(records, fmt.Sprintf(`{"schemaVersion":5,"recordId":"repeat-child-fetch-%d","type":"span","runId":"run_repeat_child_a","operationId":"run_repeat_operation","segmentId":"seg_repeat_a","segmentSeq":%d,"spanId":"repeat-child-fetch-%d","family":"tool","primitive":"tool.call","name":"fetch","toolName":"fetch","startedAt":"2026-07-20T12:10:03Z","endedAt":"2026-07-20T12:10:04Z","status":"ok"}`, index, index+2, index))
	}
	if err := service.Ingest(ctx, mustBatch(t, records...)); err != nil {
		t.Fatal(err)
	}

	signals, err := service.RunSignalsForOperations(ctx, []string{"run_repeat_operation"})
	if err != nil {
		t.Fatal(err)
	}
	operation := signals["run_repeat_operation"]
	if operation.RepeatedToolName != "search" || operation.RepeatedToolCount != 6 {
		t.Fatalf("operation repeated tools = %#v", operation)
	}
}

func TestServiceRunsRollUpUsageEventsWhenSpanMetricsAreMissing(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_usage_event_rollup","segmentId":"seg_usage_event_rollup_a","segmentSeq":1,"traceId":"trace_usage_event_rollup","name":"agent","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_usage_event_rollup","segmentId":"seg_usage_event_rollup_a","segmentSeq":2,"traceId":"trace_usage_event_rollup","spanId":"span_generate","family":"generation","primitive":"generation.call","name":"generate","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:01.010Z","durationMs":1000,"status":"ok","model":"gpt-4o-mini","provider":"openai"}`,
		`{"schemaVersion":2,"recordId":"rec_usage","type":"span:event","runId":"run_usage_event_rollup","segmentId":"seg_usage_event_rollup_a","segmentSeq":3,"traceId":"trace_usage_event_rollup","spanId":"span_generate","eventId":"evt_usage","name":"usage.observed","timestamp":"2026-05-16T18:00:01.000Z","attributes":{"inputTokens":8,"outputTokens":7,"cost":0.003}}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_usage_event_rollup","segmentId":"seg_usage_event_rollup_a","segmentSeq":4,"traceId":"trace_usage_event_rollup","endedAt":"2026-05-16T18:00:01.020Z","durationMs":1020,"status":"ok"}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	run, err := service.Run(ctx, "run_usage_event_rollup")
	if err != nil {
		t.Fatal(err)
	}
	var metrics map[string]float64
	if err := json.Unmarshal(run.Metrics, &metrics); err != nil {
		t.Fatalf("run metrics should be inspectable JSON: %v", err)
	}
	if metrics["totalTokens"] != 15 || metrics["costUsd"] != 0.003 {
		t.Fatalf("run metrics = %#v, want usage event totals", metrics)
	}
	if run.Model != "gpt-4o-mini" || run.Provider != "openai" {
		t.Fatalf("run identity = model:%q provider:%q", run.Model, run.Provider)
	}
}

func TestServiceRunDetailBuildsCanonicalMetricBucketsFromSparseUsage(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_detail_sparse_usage","segmentId":"seg_detail_sparse_usage_a","segmentSeq":1,"traceId":"trace_detail_sparse_usage","name":"agent","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_detail_sparse_usage","segmentId":"seg_detail_sparse_usage_a","segmentSeq":2,"traceId":"trace_detail_sparse_usage","spanId":"span_generate","family":"generation","primitive":"generation.stream","name":"stream","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:01.010Z","durationMs":1000,"status":"ok","model":"gpt-4o-mini","provider":"openai"}`,
		`{"schemaVersion":2,"recordId":"rec_usage","type":"span:event","runId":"run_detail_sparse_usage","segmentId":"seg_detail_sparse_usage_a","segmentSeq":3,"traceId":"trace_detail_sparse_usage","spanId":"span_generate","eventId":"evt_usage","name":"usage.observed","timestamp":"2026-05-16T18:00:01.000Z","attributes":{"inputTokens":8,"outputTokens":7,"cachedInputTokens":4,"cost":0.003,"ttftMs":125,"tokensPerSecond":14}}`,
		`{"schemaVersion":2,"recordId":"rec_output","type":"artifact","runId":"run_detail_sparse_usage","segmentId":"seg_detail_sparse_usage_a","segmentSeq":4,"traceId":"trace_detail_sparse_usage","spanId":"span_generate","artifactId":"artifact_output","kind":"stream.timeline","createdAt":"2026-05-16T18:00:01.000Z","contentType":"application/json","encoding":"json","sizeBytes":128,"preview":{"meta":{"usage":{"reasoningTokens":2}}}}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_detail_sparse_usage","segmentId":"seg_detail_sparse_usage_a","segmentSeq":5,"traceId":"trace_detail_sparse_usage","endedAt":"2026-05-16T18:00:01.020Z","durationMs":1020,"status":"ok"}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_detail_sparse_usage")
	if err != nil {
		t.Fatal(err)
	}
	generation := findRunDetailNode(&detail.Root, "span_generate")
	if generation == nil {
		t.Fatalf("tree = %#v, want generation node", detail.Root)
	}
	var own map[string]float64
	if err := json.Unmarshal(generation.MetricBuckets.Own, &own); err != nil {
		t.Fatalf("generation own metric bucket should be inspectable JSON: %v", err)
	}
	assertMetric := func(metrics map[string]float64, key string, want float64) {
		t.Helper()
		if got := metrics[key]; got != want {
			t.Fatalf("%s = %v in %#v, want %v", key, got, metrics, want)
		}
	}
	assertMetric(own, "inputTokens", 8)
	assertMetric(own, "outputTokens", 7)
	assertMetric(own, "cacheReadTokens", 4)
	assertMetric(own, "reasoningTokens", 2)
	assertMetric(own, "totalTokens", 15)
	assertMetric(own, "costUsd", 0.003)
	assertMetric(own, "ttftMs", 125)
	assertMetric(own, "tokensPerSecond", 14)
	if _, ok := own["cost"]; ok {
		t.Fatalf("generation own metric bucket = %#v, want canonical costUsd key only", own)
	}
	if _, ok := own["cachedInputTokens"]; ok {
		t.Fatalf("generation own metric bucket = %#v, want canonical cacheReadTokens key only", own)
	}

	var total map[string]float64
	if err := json.Unmarshal(detail.Root.MetricBuckets.Total, &total); err != nil {
		t.Fatalf("root total metric bucket should be inspectable JSON: %v", err)
	}
	assertMetric(total, "inputTokens", 8)
	assertMetric(total, "outputTokens", 7)
	assertMetric(total, "cacheReadTokens", 4)
	assertMetric(total, "reasoningTokens", 2)
	assertMetric(total, "totalTokens", 15)
	assertMetric(total, "costUsd", 0.003)
}

func TestServiceRunsRollUpSummariesAcrossBatches(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	count := runSummaryRollupBatchSize + 5
	records := make([]string, 0, count*4)
	start := time.Date(2026, 5, 16, 18, 0, 0, 0, time.UTC)
	for i := 0; i < count; i++ {
		runID := fmt.Sprintf("run_batch_%03d", i)
		segmentID := fmt.Sprintf("seg_batch_%03d_a", i)
		traceID := fmt.Sprintf("trace_batch_%03d", i)
		spanID := fmt.Sprintf("span_batch_%03d", i)
		eventID := fmt.Sprintf("event_batch_%03d", i)
		model := fmt.Sprintf("model-%03d", i)
		promptID := fmt.Sprintf("prompt-%03d", i)
		startedAt := start.Add(time.Duration(i) * time.Second).Format(time.RFC3339Nano)
		endedAt := start.Add(time.Duration(i)*time.Second + time.Millisecond).Format(time.RFC3339Nano)
		inputTokens := i + 1
		outputTokens := i + 2
		cost := i + 3

		records = append(records,
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"rec_run_start_%03d","type":"run:start","runId":%q,"segmentId":%q,"segmentSeq":1,"traceId":%q,"name":"batch","rootPrimitive":"agent.run","startedAt":%q,"status":"running"}`, i, runID, segmentID, traceID, startedAt),
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"rec_span_%03d","type":"span","runId":%q,"segmentId":%q,"segmentSeq":2,"traceId":%q,"spanId":%q,"family":"generation","primitive":"generation.call","name":"generate","startedAt":%q,"endedAt":%q,"durationMs":1,"status":"ok","attributes":{"model":%q,"provider":"openrouter","promptId":%q},"metrics":{"inputTokens":%d}}`, i, runID, segmentID, traceID, spanID, startedAt, endedAt, model, promptID, inputTokens),
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"rec_usage_%03d","type":"span:event","runId":%q,"segmentId":%q,"segmentSeq":3,"traceId":%q,"spanId":%q,"eventId":%q,"name":"usage.observed","timestamp":%q,"attributes":{"outputTokens":%d,"cost":%d}}`, i, runID, segmentID, traceID, spanID, eventID, endedAt, outputTokens, cost),
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"rec_run_end_%03d","type":"run:end","runId":%q,"segmentId":%q,"segmentSeq":4,"traceId":%q,"endedAt":%q,"durationMs":1,"status":"ok"}`, i, runID, segmentID, traceID, endedAt),
		)
	}

	if err := service.Ingest(ctx, mustBatch(t, records...)); err != nil {
		t.Fatal(err)
	}
	runs, err := service.Runs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != count {
		t.Fatalf("run count = %d, want %d", len(runs), count)
	}
	byRunID := make(map[string]RunSummary, len(runs))
	for _, run := range runs {
		byRunID[run.RunID] = run
	}
	for _, i := range []int{0, runSummaryRollupBatchSize - 1, runSummaryRollupBatchSize, count - 1} {
		runID := fmt.Sprintf("run_batch_%03d", i)
		run := byRunID[runID]
		if run.RunID == "" {
			t.Fatalf("missing run %q", runID)
		}
		if run.Model != fmt.Sprintf("model-%03d", i) || run.Provider != "openrouter" || run.PromptID != fmt.Sprintf("prompt-%03d", i) {
			t.Fatalf("run %q identity = model:%q provider:%q prompt:%q", runID, run.Model, run.Provider, run.PromptID)
		}
		if run.RecordCount != 4 || run.SpanCount != 1 || run.EventCount != 1 || run.ArtifactCount != 0 || run.EdgeCount != 0 {
			t.Fatalf("run %q counts = records:%d spans:%d events:%d artifacts:%d edges:%d", runID, run.RecordCount, run.SpanCount, run.EventCount, run.ArtifactCount, run.EdgeCount)
		}
		var metrics map[string]float64
		if err := json.Unmarshal(run.Metrics, &metrics); err != nil {
			t.Fatalf("run %q metrics should be inspectable JSON: %v", runID, err)
		}
		if metrics["inputTokens"] != float64(i+1) || metrics["outputTokens"] != float64(i+2) {
			t.Fatalf("run %q token metrics = %#v", runID, metrics)
		}
		if metrics["totalTokens"] != float64((i+1)+(i+2)) || metrics["costUsd"] != float64(i+3) {
			t.Fatalf("run %q aggregate metrics = %#v", runID, metrics)
		}
	}
}

func TestServiceRunSignalsDeriveQualitySummaryWithoutRunDetail(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_signals","segmentId":"seg_signals_a","segmentSeq":1,"traceId":"trace_signals","name":"agent","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_tool_ok","type":"span","runId":"run_signals","segmentId":"seg_signals_a","segmentSeq":2,"traceId":"trace_signals","spanId":"span_tool_ok","family":"tool","primitive":"tool.call","name":"search","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.020Z","durationMs":10,"status":"ok","attributes":{"toolName":"search"}}`,
		`{"schemaVersion":2,"recordId":"rec_tool_error","type":"span","runId":"run_signals","segmentId":"seg_signals_a","segmentSeq":3,"traceId":"trace_signals","spanId":"span_tool_error","family":"tool","primitive":"tool.call","name":"search","startedAt":"2026-05-16T18:00:00.030Z","endedAt":"2026-05-16T18:00:00.040Z","durationMs":10,"status":"error","attributes":{"toolName":"search"},"error":{"message":"boom"}}`,
		`{"schemaVersion":2,"recordId":"rec_retrieval","type":"span","runId":"run_signals","segmentId":"seg_signals_a","segmentSeq":4,"traceId":"trace_signals","spanId":"span_retrieval","family":"retrieval","primitive":"retrieval.query","name":"kb.search","startedAt":"2026-05-16T18:00:00.050Z","endedAt":"2026-05-16T18:00:00.060Z","durationMs":10,"status":"ok","attributes":{"resultCount":0}}`,
		`{"schemaVersion":2,"recordId":"rec_guardrail","type":"span","runId":"run_signals","segmentId":"seg_signals_a","segmentSeq":5,"traceId":"trace_signals","spanId":"span_guardrail","family":"guardrail","primitive":"guardrail.run","name":"policy","startedAt":"2026-05-16T18:00:00.070Z","endedAt":"2026-05-16T18:00:00.080Z","durationMs":10,"status":"blocked"}`,
		`{"schemaVersion":2,"recordId":"rec_suspension","type":"span","runId":"run_signals","segmentId":"seg_signals_a","segmentSeq":6,"traceId":"trace_signals","spanId":"span_suspension","family":"flow","primitive":"flow.suspension","name":"approval","startedAt":"2026-05-16T18:00:00.090Z","endedAt":"2026-05-16T18:00:00.100Z","durationMs":10,"status":"suspended"}`,
		`{"schemaVersion":2,"recordId":"rec_missing_parent","type":"span","runId":"run_signals","segmentId":"seg_signals_a","segmentSeq":7,"traceId":"trace_signals","spanId":"span_orphan","parentSpanId":"span_missing","family":"generation","primitive":"generation.call","name":"orphan","startedAt":"2026-05-16T18:00:00.110Z","endedAt":"2026-05-16T18:00:00.120Z","durationMs":10,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_signals","segmentId":"seg_signals_a","segmentSeq":8,"traceId":"trace_signals","endedAt":"2026-05-16T18:00:01.000Z","durationMs":1000,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	signals, err := service.RunSignals(ctx)
	if err != nil {
		t.Fatal(err)
	}
	signal := signals["run_signals"]
	if signal.ToolCallCount != 2 || signal.ToolErrorCount != 1 || signal.RepeatedToolName != "search" || signal.RepeatedToolCount != 2 {
		t.Fatalf("tool signals = %#v", signal)
	}
	if signal.RetrievalIssueCount != 1 || signal.InspectSignalIssueCount != 1 || signal.BlockedSignalCount != 1 || signal.SuspensionSignalCount != 1 {
		t.Fatalf("attention signals = %#v", signal)
	}
	if signal.DiagnosticCount == 0 || !containsTestString(signal.DiagnosticCodes, "missing-parent-span") {
		t.Fatalf("diagnostics = %#v, want missing-parent-span", signal.DiagnosticCodes)
	}
}

func TestServiceRetainsOutOfOrderChildSpansUntilParentArrives(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)

	childFirst := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_out_of_order","segmentId":"seg_out_of_order_a","segmentSeq":1,"traceId":"trace_out_of_order","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_child_start","type":"span:start","runId":"run_out_of_order","segmentId":"seg_out_of_order_a","segmentSeq":2,"traceId":"trace_out_of_order","spanId":"span_child","parentSpanId":"span_parent","family":"tool","primitive":"tool.call","name":"research","startedAt":"2026-05-16T18:00:00.020Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_child_end","type":"span:end","runId":"run_out_of_order","segmentId":"seg_out_of_order_a","segmentSeq":3,"traceId":"trace_out_of_order","spanId":"span_child","endedAt":"2026-05-16T18:00:00.030Z","durationMs":10,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, childFirst); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_out_of_order")
	if err != nil {
		t.Fatal(err)
	}
	foundMissingParent := false
	for _, diagnostic := range detail.Diagnostics {
		if diagnostic.Code == "missing-parent-span" {
			foundMissingParent = true
			break
		}
	}
	if !foundMissingParent {
		t.Fatalf("diagnostics before parent = %#v, want missing-parent-span", detail.Diagnostics)
	}

	parentLater := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_parent_start","type":"span:start","runId":"run_out_of_order","segmentId":"seg_out_of_order_a","segmentSeq":4,"traceId":"trace_out_of_order","spanId":"span_parent","family":"agent","primitive":"agent.run","name":"Support Agent","startedAt":"2026-05-16T18:00:00.010Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_parent_end","type":"span:end","runId":"run_out_of_order","segmentId":"seg_out_of_order_a","segmentSeq":5,"traceId":"trace_out_of_order","spanId":"span_parent","endedAt":"2026-05-16T18:00:00.040Z","durationMs":30,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_out_of_order","segmentId":"seg_out_of_order_a","segmentSeq":6,"traceId":"trace_out_of_order","endedAt":"2026-05-16T18:00:00.050Z","durationMs":50,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, parentLater); err != nil {
		t.Fatal(err)
	}

	detail, err = service.RunDetail(ctx, "run_out_of_order")
	if err != nil {
		t.Fatal(err)
	}
	for _, diagnostic := range detail.Diagnostics {
		if diagnostic.Code == "missing-parent-span" {
			t.Fatalf("diagnostics after parent = %#v, want parent repaired", detail.Diagnostics)
		}
	}
	parentPlacement, ok := detail.SpanIndex["span_parent"]
	if !ok || parentPlacement.Placement != "node" || parentPlacement.NodeID != "run:run_out_of_order" {
		t.Fatalf("parent placement = %#v, want late parent to become run root", parentPlacement)
	}
	childPlacement, ok := detail.SpanIndex["span_child"]
	if !ok || childPlacement.Placement != "node" || len(childPlacement.Path) < 2 || childPlacement.Path[0] != "run:run_out_of_order" {
		t.Fatalf("child placement = %#v, want child retained after late parent", childPlacement)
	}
}

func TestServiceRunsFillMissingCostWhenRunAlreadyHasTokens(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_partial_metrics","segmentId":"seg_partial_metrics_a","segmentSeq":1,"traceId":"trace_partial_metrics","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_partial_metrics","segmentId":"seg_partial_metrics_a","segmentSeq":2,"traceId":"trace_partial_metrics","spanId":"span_generate","family":"generation","primitive":"generation.call","name":"generate","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:01.010Z","durationMs":1000,"status":"ok","metrics":{"costUsd":0.004}}`,
		`{"schemaVersion":2,"recordId":"rec_usage","type":"span:event","runId":"run_partial_metrics","segmentId":"seg_partial_metrics_a","segmentSeq":3,"traceId":"trace_partial_metrics","spanId":"span_generate","eventId":"evt_usage","name":"usage.observed","timestamp":"2026-05-16T18:00:01.000Z","attributes":{"cost":0.004}}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_partial_metrics","segmentId":"seg_partial_metrics_a","segmentSeq":4,"traceId":"trace_partial_metrics","endedAt":"2026-05-16T18:00:01.020Z","durationMs":1020,"status":"ok","metrics":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	run, err := service.Run(ctx, "run_partial_metrics")
	if err != nil {
		t.Fatal(err)
	}
	var metrics map[string]float64
	if err := json.Unmarshal(run.Metrics, &metrics); err != nil {
		t.Fatalf("run metrics should be inspectable JSON: %v", err)
	}
	if metrics["totalTokens"] != 15 || metrics["costUsd"] != 0.004 {
		t.Fatalf("run metrics = %#v, want existing tokens plus rolled up cost", metrics)
	}
}

func TestServiceRunDetailMarksMissingEndsAsStalePresentation(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	started := time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)

	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_stale","segmentId":"seg_stale_a","segmentSeq":1,"traceId":"trace_stale","name":"chat","rootPrimitive":"agent.run","startedAt":"`+started+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_stale","segmentId":"seg_stale_a","segmentSeq":2,"traceId":"trace_stale","spanId":"span_agent","family":"agent","primitive":"agent.run","name":"chat","startedAt":"`+started+`","status":"running"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	graph, err := service.Graph(ctx, "run_stale")
	if err != nil {
		t.Fatal(err)
	}
	if graph.Run.Status != "running" || graph.Spans[0].Status != "running" {
		t.Fatalf("canonical graph statuses = %q/%q, want running/running", graph.Run.Status, graph.Spans[0].Status)
	}

	detail, err := service.RunDetail(ctx, "run_stale")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Run.Status != "incomplete" || detail.Root.Status != "incomplete" {
		t.Fatalf("presentation statuses = %q/%q, want incomplete/incomplete", detail.Run.Status, detail.Root.Status)
	}
	if detail.Run.DurationMs <= 0 || detail.Root.DurationMs <= 0 {
		t.Fatalf("presentation durations = %f/%f, want elapsed stale durations", detail.Run.DurationMs, detail.Root.DurationMs)
	}
	if len(detail.Diagnostics) == 0 || detail.Diagnostics[0].Code != "stale-boundary" {
		t.Fatalf("run diagnostics = %#v, want stale-boundary", detail.Diagnostics)
	}
	if len(detail.Root.Diagnostics) == 0 || detail.Root.Diagnostics[0].Code != "missing-span-end" {
		t.Fatalf("span diagnostics = %#v, want missing-span-end", detail.Root.Diagnostics)
	}
}

func TestServiceRunDetailDoesNotWarnOrSuppressDiagnosticsForSharedTrace(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	started := time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)

	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_shared_trace_parent_start","type":"run:start","runId":"run_shared_trace_parent","segmentId":"seg_shared_trace_parent_a","segmentSeq":1,"traceId":"trace_shared","name":"parent flow","rootPrimitive":"flow.run","startedAt":"`+started+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_shared_trace_parent_span","type":"span:start","runId":"run_shared_trace_parent","segmentId":"seg_shared_trace_parent_a","segmentSeq":2,"traceId":"trace_shared","spanId":"span_shared_trace_parent","family":"agent","primitive":"agent.run","name":"still running","startedAt":"`+started+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_shared_trace_child_start","type":"run:start","runId":"run_shared_trace_child","segmentId":"seg_shared_trace_child_a","segmentSeq":1,"traceId":"trace_shared","name":"nested child flow","rootPrimitive":"flow.run","startedAt":"`+started+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_shared_trace_child_end","type":"run:end","runId":"run_shared_trace_child","segmentId":"seg_shared_trace_child_a","segmentSeq":2,"traceId":"trace_shared","endedAt":"`+started+`","status":"ok"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_shared_trace_parent")
	if err != nil {
		t.Fatal(err)
	}
	var staleBoundary, traceAliasConflict *RunDetailDiagnostic
	for index := range detail.Diagnostics {
		switch detail.Diagnostics[index].Code {
		case "stale-boundary":
			staleBoundary = &detail.Diagnostics[index]
		case "trace-alias-conflict":
			traceAliasConflict = &detail.Diagnostics[index]
		}
	}
	if staleBoundary == nil {
		t.Fatalf("diagnostics = %#v, want stale-boundary to survive a legitimate shared trace", detail.Diagnostics)
	}
	if traceAliasConflict != nil {
		t.Fatalf("diagnostics = %#v, want no trace-alias-conflict warning for a normal shared trace", detail.Diagnostics)
	}

	run, err := service.Run(ctx, "run_shared_trace_parent")
	if err != nil {
		t.Fatal(err)
	}
	if run.TraceAliasConflict {
		t.Fatalf("run = %#v, shared W3C trace must not be treated as an identity conflict", run)
	}
}

func TestServiceRunDetailReconcilesExpiredOperationDeadlineThroughAncestors(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	started := time.Now().Add(-2 * time.Minute).UTC()
	generationStarted := started.Add(4 * time.Second).UTC()
	deadline := generationStarted.Add(60 * time.Second).UTC()

	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_deadline","segmentId":"seg_deadline_a","segmentSeq":1,"traceId":"trace_deadline","name":"chat","rootPrimitive":"agent.run","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_deadline","segmentId":"seg_deadline_a","segmentSeq":2,"traceId":"trace_deadline","spanId":"span_chat","family":"agent","primitive":"agent.run","name":"chat","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_tool","type":"span:start","runId":"run_deadline","segmentId":"seg_deadline_a","segmentSeq":3,"traceId":"trace_deadline","spanId":"span_tool","parentSpanId":"span_chat","family":"tool","primitive":"tool.call","name":"writer","startedAt":"`+started.Add(time.Second).Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_flow","type":"span:start","runId":"run_deadline","segmentId":"seg_deadline_a","segmentSeq":4,"traceId":"trace_deadline","spanId":"span_flow","parentSpanId":"span_tool","family":"flow","primitive":"flow.run","name":"writer","startedAt":"`+started.Add(2*time.Second).Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_step","type":"span:start","runId":"run_deadline","segmentId":"seg_deadline_a","segmentSeq":5,"traceId":"trace_deadline","spanId":"span_step","parentSpanId":"span_flow","family":"flow","primitive":"flow.step","name":"plan","startedAt":"`+started.Add(3*time.Second).Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_gen","type":"span:start","runId":"run_deadline","segmentId":"seg_deadline_a","segmentSeq":6,"traceId":"trace_deadline","spanId":"span_generate","parentSpanId":"span_step","family":"generation","primitive":"generation.call","name":"generate writer-prose-plan","startedAt":"`+generationStarted.Format(time.RFC3339Nano)+`","status":"running","attributes":{"timeoutMs":60000}}`,
		`{"schemaVersion":2,"recordId":"rec_deadline","type":"span:event","runId":"run_deadline","segmentId":"seg_deadline_a","segmentSeq":7,"traceId":"trace_deadline","spanId":"span_generate","eventId":"event_deadline","name":"operation.deadline","timestamp":"`+generationStarted.Format(time.RFC3339Nano)+`","attributes":{"timeoutMs":60000,"deadlineAt":"`+deadline.Format(time.RFC3339Nano)+`"}}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	graph, err := service.Graph(ctx, "run_deadline")
	if err != nil {
		t.Fatal(err)
	}
	if graph.Run.Status != "running" {
		t.Fatalf("canonical run status = %q, want running", graph.Run.Status)
	}

	detail, err := service.RunDetail(ctx, "run_deadline")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Run.Status != "incomplete" || detail.Root.Status != "incomplete" {
		t.Fatalf("presentation statuses = run:%q root:%q, want incomplete/incomplete", detail.Run.Status, detail.Root.Status)
	}
	generation := findRunDetailNode(&detail.Root, "span_generate")
	if generation == nil {
		t.Fatalf("tree = %#v, want generation node", detail.Root)
	}
	if generation.Status != "incomplete" || generation.Timing.EndedAt != deadline.Format(time.RFC3339Nano) {
		t.Fatalf("generation = %#v, want incomplete telemetry with reconciled end", generation)
	}
	if len(generation.Diagnostics) == 0 || generation.Diagnostics[0].Code != "operation-deadline-exceeded" {
		t.Fatalf("generation diagnostics = %#v, want operation-deadline-exceeded", generation.Diagnostics)
	}
	step := findRunDetailNode(&detail.Root, "span_step")
	if step == nil || step.Status != "incomplete" {
		t.Fatalf("step = %#v, want propagated incompleteness", step)
	}
}

func TestServiceRunDetailPrefersTerminalAncestorOverExpiredOperationDeadline(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	started := time.Now().Add(-2 * time.Minute).UTC()
	generationStarted := started.Add(4 * time.Second).UTC()
	flowEnded := generationStarted.Add(6 * time.Second).UTC()
	deadline := generationStarted.Add(60 * time.Second).UTC()

	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_suspend_deadline","segmentId":"seg_suspend_deadline_a","segmentSeq":1,"traceId":"trace_suspend_deadline","name":"chat","rootPrimitive":"agent.run","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_suspend_deadline","segmentId":"seg_suspend_deadline_a","segmentSeq":2,"traceId":"trace_suspend_deadline","spanId":"span_chat","family":"agent","primitive":"agent.run","name":"chat","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_flow","type":"span:start","runId":"run_suspend_deadline","segmentId":"seg_suspend_deadline_a","segmentSeq":3,"traceId":"trace_suspend_deadline","spanId":"span_flow","parentSpanId":"span_chat","family":"flow","primitive":"flow.run","name":"writer","startedAt":"`+started.Add(2*time.Second).Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_step","type":"span:start","runId":"run_suspend_deadline","segmentId":"seg_suspend_deadline_a","segmentSeq":4,"traceId":"trace_suspend_deadline","spanId":"span_step","parentSpanId":"span_flow","family":"flow","primitive":"flow.step","name":"plan","startedAt":"`+started.Add(3*time.Second).Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_gen","type":"span:start","runId":"run_suspend_deadline","segmentId":"seg_suspend_deadline_a","segmentSeq":5,"traceId":"trace_suspend_deadline","spanId":"span_generate","parentSpanId":"span_step","family":"generation","primitive":"generation.call","name":"generate writer-prose-plan","startedAt":"`+generationStarted.Format(time.RFC3339Nano)+`","status":"running","attributes":{"timeoutMs":60000}}`,
		`{"schemaVersion":2,"recordId":"rec_deadline","type":"span:event","runId":"run_suspend_deadline","segmentId":"seg_suspend_deadline_a","segmentSeq":6,"traceId":"trace_suspend_deadline","spanId":"span_generate","eventId":"event_deadline","name":"operation.deadline","timestamp":"`+generationStarted.Format(time.RFC3339Nano)+`","attributes":{"timeoutMs":60000,"deadlineAt":"`+deadline.Format(time.RFC3339Nano)+`"}}`,
		`{"schemaVersion":2,"recordId":"rec_output","type":"artifact","runId":"run_suspend_deadline","segmentId":"seg_suspend_deadline_a","segmentSeq":7,"traceId":"trace_suspend_deadline","artifactId":"artifact_plan","spanId":"span_generate","kind":"output","createdAt":"`+flowEnded.Add(-time.Second).Format(time.RFC3339Nano)+`","contentType":"application/json","encoding":"json","preview":{"text":"plan ready"}}`,
		`{"schemaVersion":2,"recordId":"rec_flow_suspend","type":"span:end","runId":"run_suspend_deadline","segmentId":"seg_suspend_deadline_a","segmentSeq":8,"traceId":"trace_suspend_deadline","spanId":"span_flow","endedAt":"`+flowEnded.Format(time.RFC3339Nano)+`","durationMs":8000,"status":"suspended","attributes":{"suspendedAt":"plan-approval"}}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_suspend_deadline")
	if err != nil {
		t.Fatal(err)
	}
	generation := findRunDetailNode(&detail.Root, "span_generate")
	if generation == nil {
		t.Fatalf("tree = %#v, want generation node", detail.Root)
	}
	if generation.Status != "ok" || generation.Timing.EndedAt != flowEnded.Format(time.RFC3339Nano) {
		t.Fatalf("generation = %#v, want ok from terminal ancestor rather than incomplete deadline", generation)
	}
	step := findRunDetailNode(&detail.Root, "span_step")
	if step == nil || step.Status != "suspended" {
		t.Fatalf("step = %#v, want suspended from terminal ancestor", step)
	}
	if detail.Run.Status != "suspended" || detail.Root.Status != "suspended" {
		t.Fatalf("statuses = run:%q root:%q, want suspended/suspended", detail.Run.Status, detail.Root.Status)
	}
	if len(generation.Diagnostics) != 0 {
		t.Fatalf("generation diagnostics = %#v, want no incomplete deadline diagnostic", generation.Diagnostics)
	}
}

func TestServiceRunDetailDoesNotMarkActiveDeadlineProtectedBranchStale(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	started := time.Now().Add(-35 * time.Second).UTC()
	deadline := time.Now().Add(90 * time.Second).UTC()

	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_active_deadline","segmentId":"seg_active_deadline_a","segmentSeq":1,"traceId":"trace_active_deadline","name":"chat","rootPrimitive":"agent.run","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_active_deadline","segmentId":"seg_active_deadline_a","segmentSeq":2,"traceId":"trace_active_deadline","spanId":"span_chat","family":"agent","primitive":"agent.run","name":"chat","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_gen","type":"span:start","runId":"run_active_deadline","segmentId":"seg_active_deadline_a","segmentSeq":3,"traceId":"trace_active_deadline","spanId":"span_generate","parentSpanId":"span_chat","family":"generation","primitive":"generation.call","name":"generate","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running","attributes":{"timeoutMs":120000,"deadlineAt":"`+deadline.Format(time.RFC3339Nano)+`"}}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_active_deadline")
	if err != nil {
		t.Fatal(err)
	}
	generation := findRunDetailNode(&detail.Root, "span_generate")
	if detail.Run.Status != "running" || detail.Root.Status != "running" || generation == nil || generation.Status != "running" {
		t.Fatalf("statuses = run:%q root:%q generation:%#v, want running while deadline is still active", detail.Run.Status, detail.Root.Status, generation)
	}
}

func TestServiceShowsSuspendedRunThenContinuesSameRun(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)

	suspendedBatch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_suspend","segmentId":"seg_suspend_a","segmentSeq":1,"traceId":"trace_suspend","name":"review-flow","rootPrimitive":"flow.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_flow_start","type":"span:start","runId":"run_suspend","segmentId":"seg_suspend_a","segmentSeq":2,"traceId":"trace_suspend","spanId":"span_flow_1","family":"flow","primitive":"flow.run","name":"review-flow","startedAt":"2026-05-16T18:00:00.001Z","status":"running","attributes":{"flowId":"flow-1","resume":false}}`,
		`{"schemaVersion":2,"recordId":"rec_step_start","type":"span:start","runId":"run_suspend","segmentId":"seg_suspend_a","segmentSeq":3,"traceId":"trace_suspend","spanId":"span_step_1","parentSpanId":"span_flow_1","family":"flow","primitive":"flow.step","name":"draft","startedAt":"2026-05-16T18:00:00.002Z","status":"running","attributes":{"flowId":"flow-1","stepId":"draft-1"}}`,
		`{"schemaVersion":2,"recordId":"rec_step_end","type":"span:end","runId":"run_suspend","segmentId":"seg_suspend_a","segmentSeq":4,"traceId":"trace_suspend","spanId":"span_step_1","endedAt":"2026-05-16T18:00:00.020Z","durationMs":18,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_flow_suspend","type":"span:end","runId":"run_suspend","segmentId":"seg_suspend_a","segmentSeq":5,"traceId":"trace_suspend","spanId":"span_flow_1","endedAt":"2026-05-16T18:00:00.030Z","durationMs":29,"status":"suspended","attributes":{"suspendedAt":"approval","totalSteps":1}}`,
		`{"schemaVersion":2,"recordId":"rec_run_suspend","type":"run:suspend","runId":"run_suspend","segmentId":"seg_suspend_a","segmentSeq":6,"traceId":"trace_suspend","suspendedAt":"2026-05-16T18:00:00.031Z","reason":"approval"}`,
	)
	if err := service.Ingest(ctx, suspendedBatch); err != nil {
		t.Fatal(err)
	}

	run, err := service.Run(ctx, "run_suspend")
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "suspended" {
		t.Fatalf("run status = %q, want suspended", run.Status)
	}
	detail, err := service.RunDetail(ctx, "run_suspend")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Run.Status != "suspended" || detail.Root.Status != "suspended" {
		t.Fatalf("detail statuses = run:%q root:%q, want suspended", detail.Run.Status, detail.Root.Status)
	}

	resumeBatch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_resume","type":"run:resume","runId":"run_suspend","segmentId":"seg_suspend_b","segmentSeq":1,"traceId":"trace_suspend","resumedAt":"2026-05-16T18:00:01.000Z","reason":"approval-granted","previousSegmentId":"seg_suspend_a"}`,
		`{"schemaVersion":2,"recordId":"rec_flow_resume_start","type":"span:start","runId":"run_suspend","segmentId":"seg_suspend_b","segmentSeq":2,"traceId":"trace_suspend","spanId":"span_flow_2","family":"flow","primitive":"flow.run","name":"review-flow","startedAt":"2026-05-16T18:00:01.000Z","status":"running","attributes":{"flowId":"flow-1","resume":true}}`,
		`{"schemaVersion":2,"recordId":"rec_publish_start","type":"span:start","runId":"run_suspend","segmentId":"seg_suspend_b","segmentSeq":3,"traceId":"trace_suspend","spanId":"span_step_2","parentSpanId":"span_flow_2","family":"flow","primitive":"flow.step","name":"publish","startedAt":"2026-05-16T18:00:01.001Z","status":"running","attributes":{"flowId":"flow-1","stepId":"publish-2"}}`,
		`{"schemaVersion":2,"recordId":"rec_publish_end","type":"span:end","runId":"run_suspend","segmentId":"seg_suspend_b","segmentSeq":4,"traceId":"trace_suspend","spanId":"span_step_2","endedAt":"2026-05-16T18:00:01.020Z","durationMs":19,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_flow_resume_end","type":"span:end","runId":"run_suspend","segmentId":"seg_suspend_b","segmentSeq":5,"traceId":"trace_suspend","spanId":"span_flow_2","endedAt":"2026-05-16T18:00:01.030Z","durationMs":30,"status":"ok","attributes":{"flowStatus":"completed","totalSteps":1}}`,
		`{"schemaVersion":2,"recordId":"rec_run_complete","type":"run:end","runId":"run_suspend","segmentId":"seg_suspend_b","segmentSeq":6,"traceId":"trace_suspend","endedAt":"2026-05-16T18:00:01.031Z","durationMs":1031,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, resumeBatch); err != nil {
		t.Fatal(err)
	}

	run, err = service.Run(ctx, "run_suspend")
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "ok" || run.SpanCount != 4 {
		t.Fatalf("resumed run = %#v, want ok status and four spans", run)
	}
	detail, err = service.RunDetail(ctx, "run_suspend")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Run.Status != "ok" {
		t.Fatalf("detail run status = %q, want ok", detail.Run.Status)
	}
	if len(detail.Root.Children) != 2 {
		t.Fatalf("root children = %d, want initial suspended flow and resumed flow", len(detail.Root.Children))
	}
}

func TestServiceRunDetailAttachesWrapperAndRunLevelDetails(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_view","segmentId":"seg_view_a","segmentSeq":1,"traceId":"trace_view","name":"daily-briefing","rootPrimitive":"task.operation","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_context","type":"span","runId":"run_view","segmentId":"seg_view_a","segmentSeq":2,"traceId":"trace_view","spanId":"span_context","family":"context","primitive":"context.resolve","name":"response-language","startedAt":"2026-05-16T18:00:00.001Z","endedAt":"2026-05-16T18:00:00.003Z","durationMs":2,"status":"ok","attributes":{"included":true,"language":"nl"}}`,
		`{"schemaVersion":2,"recordId":"rec_router","type":"span:start","runId":"run_view","segmentId":"seg_view_a","segmentSeq":3,"traceId":"trace_view","spanId":"span_router","family":"routing","primitive":"routing.router","name":"router.resolve","startedAt":"2026-05-16T18:00:00.004Z","status":"running","attributes":{"classifiedAs":"structured-cheap"}}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_view","segmentId":"seg_view_a","segmentSeq":4,"traceId":"trace_view","spanId":"span_generate","parentSpanId":"span_router","family":"generation","primitive":"generation.call","name":"generate daily-briefing","startedAt":"2026-05-16T18:00:00.005Z","endedAt":"2026-05-16T18:00:02.105Z","durationMs":2100,"status":"ok","model":"gemini","provider":"google","metrics":{"totalTokens":420}}`,
		`{"schemaVersion":2,"recordId":"rec_router_end","type":"span:end","runId":"run_view","segmentId":"seg_view_a","segmentSeq":5,"traceId":"trace_view","spanId":"span_router","endedAt":"2026-05-16T18:00:02.110Z","durationMs":2106,"status":"ok","attributes":{"selectedModel":"google/gemini"}}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_view","segmentId":"seg_view_a","segmentSeq":6,"traceId":"trace_view","endedAt":"2026-05-16T18:00:02.120Z","durationMs":2120,"status":"ok"}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_view")
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Root.Children) != 1 {
		t.Fatalf("visible children = %d, want 1", len(detail.Root.Children))
	}
	generation := detail.Root.Children[0]
	if generation.SpanID != "span_generate" || generation.Display.Kind != "generation" {
		t.Fatalf("visible generation node = %#v", generation)
	}
	if generation.ParentID != detail.Root.ID {
		t.Fatalf("generation should be hoisted to run root, parentId = %q", generation.ParentID)
	}
	if len(generation.Details) != 1 || generation.Details[0].SpanID != "span_router" {
		t.Fatalf("generation details = %#v, want router detail", generation.Details)
	}
	if len(detail.Root.Details) != 1 || detail.Root.Details[0].SpanID != "span_context" {
		t.Fatalf("run details = %#v, want context detail", detail.Root.Details)
	}
	if detail.Counts.AttachedDetails != 2 {
		t.Fatalf("attached details = %d, want 2", detail.Counts.AttachedDetails)
	}
}

func TestServiceRunDetailBuffersSiblingDetailsOntoNextPrimarySpan(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_generation_view","segmentId":"seg_generation_view_a","segmentSeq":1,"traceId":"trace_generation_view","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_generation_view","segmentId":"seg_generation_view_a","segmentSeq":2,"traceId":"trace_generation_view","spanId":"span_agent","family":"agent","primitive":"agent.run","name":"chat","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_prompt","type":"span","runId":"run_generation_view","segmentId":"seg_generation_view_a","segmentSeq":3,"traceId":"trace_generation_view","spanId":"span_prompt","parentSpanId":"span_agent","family":"prompt","primitive":"prompt.resolve","name":"support-agent","startedAt":"2026-05-16T18:00:00.002Z","endedAt":"2026-05-16T18:00:00.012Z","durationMs":10,"status":"ok","attributes":{"promptId":"support-agent"}}`,
		`{"schemaVersion":2,"recordId":"rec_context","type":"span","runId":"run_generation_view","segmentId":"seg_generation_view_a","segmentSeq":4,"traceId":"trace_generation_view","spanId":"span_context","parentSpanId":"span_agent","family":"context","primitive":"context.resolve","name":"brand-voice","startedAt":"2026-05-16T18:00:00.013Z","endedAt":"2026-05-16T18:00:00.018Z","durationMs":5,"status":"ok","attributes":{"contextId":"brand-voice","included":true}}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_generation_view","segmentId":"seg_generation_view_a","segmentSeq":5,"traceId":"trace_generation_view","spanId":"span_generate","parentSpanId":"span_agent","family":"generation","primitive":"generation.call","name":"generate support-agent","startedAt":"2026-05-16T18:00:00.020Z","endedAt":"2026-05-16T18:00:01.020Z","durationMs":1000,"status":"ok","model":"gpt-4o","provider":"openai"}`,
		`{"schemaVersion":2,"recordId":"rec_cost","type":"span","runId":"run_generation_view","segmentId":"seg_generation_view_a","segmentSeq":6,"traceId":"trace_generation_view","spanId":"span_cost","parentSpanId":"span_agent","family":"cost","primitive":"cost.record","name":"usage","startedAt":"2026-05-16T18:00:01.021Z","endedAt":"2026-05-16T18:00:01.022Z","durationMs":1,"status":"ok","attributes":{"cost":0.01}}`,
		`{"schemaVersion":2,"recordId":"rec_agent_end","type":"span:end","runId":"run_generation_view","segmentId":"seg_generation_view_a","segmentSeq":7,"traceId":"trace_generation_view","spanId":"span_agent","endedAt":"2026-05-16T18:00:01.030Z","durationMs":1029,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_generation_view","segmentId":"seg_generation_view_a","segmentSeq":8,"traceId":"trace_generation_view","endedAt":"2026-05-16T18:00:01.040Z","durationMs":1040,"status":"ok"}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_generation_view")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Root.SpanID != "span_agent" {
		t.Fatalf("root = %#v, want agent root", detail.Root)
	}
	if len(detail.Root.Children) != 1 || detail.Root.Children[0].SpanID != "span_generate" {
		t.Fatalf("root children = %#v, want generation only", detail.Root.Children)
	}
	generation := detail.Root.Children[0]
	if len(generation.Details) != 2 {
		t.Fatalf("generation details = %#v, want prompt + context", generation.Details)
	}
	if generation.Details[0].SpanID != "span_prompt" || generation.Details[1].SpanID != "span_context" {
		t.Fatalf("generation detail ids = %#v", generation.Details)
	}
	if len(detail.Root.Details) != 1 || detail.Root.Details[0].SpanID != "span_cost" {
		t.Fatalf("root trailing details = %#v, want cost", detail.Root.Details)
	}
}

func TestServiceRunDetailIsRootedTotalAndDumbClientReady(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":1,"traceId":"trace_detail","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":2,"traceId":"trace_detail","spanId":"span_agent","family":"agent","primitive":"agent.run","name":"chat","startedAt":"2026-05-16T18:00:00.001Z","status":"running","agentId":"chat"}`,
		`{"schemaVersion":2,"recordId":"rec_prompt","type":"span","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":3,"traceId":"trace_detail","spanId":"span_prompt","parentSpanId":"span_agent","family":"prompt","primitive":"prompt.resolve","name":"main prompt","startedAt":"2026-05-16T18:00:00.002Z","endedAt":"2026-05-16T18:00:00.012Z","durationMs":10,"status":"ok","promptId":"chat.prompt","attributes":{"presentation":{"ownerSpanId":"span_generate","label":"Chat prompt"}}}`,
		`{"schemaVersion":2,"recordId":"rec_memory","type":"span","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":4,"traceId":"trace_detail","spanId":"span_memory","parentSpanId":"span_agent","family":"memory","primitive":"memory.read","name":"facts.find","startedAt":"2026-05-16T18:00:00.013Z","endedAt":"2026-05-16T18:00:00.018Z","durationMs":5,"status":"ok","memoryId":"facts","attributes":{"presentation":{"display":"detail","ownerSpanId":"span_generate"}}}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":5,"traceId":"trace_detail","spanId":"span_generate","parentSpanId":"span_agent","family":"generation","primitive":"generation.stream","name":"generate chat","startedAt":"2026-05-16T18:00:00.020Z","endedAt":"2026-05-16T18:00:01.020Z","durationMs":1000,"status":"ok","model":"gpt-4o","provider":"openai","metrics":{"inputTokens":10,"outputTokens":20,"totalTokens":30,"costUsd":0.01}}`,
		`{"schemaVersion":2,"recordId":"rec_token","type":"span:event","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":6,"traceId":"trace_detail","spanId":"span_generate","eventId":"event_token_1","name":"token.chunk","timestamp":"2026-05-16T18:00:00.100Z","attributes":{"chunkIndex":0,"charCount":5,"text":"Hello","firstDeltaAt":"2026-05-16T18:00:00.090Z","lastDeltaAt":"2026-05-16T18:00:00.100Z"}}`,
		`{"schemaVersion":2,"recordId":"rec_tool","type":"span","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":7,"traceId":"trace_detail","spanId":"span_tool","parentSpanId":"span_agent","family":"tool","primitive":"tool.call","name":"call_abc123","toolName":"searchDocs","startedAt":"2026-05-16T18:00:01.030Z","endedAt":"2026-05-16T18:00:01.130Z","durationMs":100,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_late_context","type":"span","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":8,"traceId":"trace_detail","spanId":"span_late_context","parentSpanId":"span_agent","family":"context","primitive":"context.resolve","name":"late context","startedAt":"2026-05-16T18:00:01.140Z","endedAt":"2026-05-16T18:00:01.145Z","durationMs":5,"status":"ok","contextId":"late.context"}`,
		`{"schemaVersion":2,"recordId":"rec_artifact","type":"artifact","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":9,"traceId":"trace_detail","spanId":"span_generate","artifactId":"artifact_output","kind":"output","createdAt":"2026-05-16T18:00:01.020Z","contentType":"text/plain","encoding":"text","sizeBytes":11,"preview":"Hello world"}`,
		`{"schemaVersion":2,"recordId":"rec_edge","type":"edge","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":10,"traceId":"trace_detail","edgeId":"edge_prompt_explains_generate","edgeType":"explains","from":{"kind":"span","id":"span_prompt"},"to":{"kind":"span","id":"span_generate"},"createdAt":"2026-05-16T18:00:00.020Z","attributes":{"role":"input"}}`,
		`{"schemaVersion":2,"recordId":"rec_late_edge","type":"edge","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":11,"traceId":"trace_detail","edgeId":"edge_late_context_explains_generate","edgeType":"explains","from":{"kind":"span","id":"span_late_context"},"to":{"kind":"span","id":"span_generate"},"createdAt":"2026-05-16T18:00:01.146Z","attributes":{"role":"context"}}`,
		`{"schemaVersion":2,"recordId":"rec_agent_end","type":"span:end","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":12,"traceId":"trace_detail","spanId":"span_agent","endedAt":"2026-05-16T18:00:01.200Z","durationMs":1199,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_detail","segmentId":"seg_detail_a","segmentSeq":13,"traceId":"trace_detail","endedAt":"2026-05-16T18:00:01.210Z","durationMs":1210,"status":"ok"}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_detail")
	if err != nil {
		t.Fatal(err)
	}
	if detail.SchemaVersion != SchemaVersion {
		t.Fatalf("schemaVersion = %d", detail.SchemaVersion)
	}
	if detail.Root.ID != "run:run_detail" || detail.Root.SpanID != "span_agent" || detail.Root.Display.Label != "chat" {
		t.Fatalf("root = %#v", detail.Root)
	}
	if len(detail.Rows) < 3 {
		t.Fatalf("rows = %#v, want root plus visible children", detail.Rows)
	}
	if detail.SpanIndex["span_prompt"].Placement != "detail" {
		t.Fatalf("span prompt placement = %#v, want detail", detail.SpanIndex["span_prompt"])
	}
	if detail.SpanIndex["span_generate"].Placement != "node" {
		t.Fatalf("span generate placement = %#v, want node", detail.SpanIndex["span_generate"])
	}
	var generation *RunDetailNode
	for i := range detail.Root.Children {
		if detail.Root.Children[i].SpanID == "span_generate" {
			generation = &detail.Root.Children[i]
			break
		}
	}
	if generation == nil {
		t.Fatalf("root children = %#v, want generation child", detail.Root.Children)
	}
	if len(generation.Details) != 3 {
		t.Fatalf("generation details = %#v, want prompt + memory + late context", generation.Details)
	}
	if generation.Details[0].SpanID != "span_prompt" || generation.Details[0].Source.PlacementReason != "explains-edge" {
		t.Fatalf("prompt detail = %#v, want explains-edge", generation.Details[0])
	}
	if generation.Details[1].SpanID != "span_memory" || generation.Details[1].Source.PlacementReason != "owner-hint" {
		t.Fatalf("memory detail = %#v, want owner-hint", generation.Details[1])
	}
	if generation.Details[2].SpanID != "span_late_context" || generation.Details[2].Source.PlacementReason != "explains-edge" {
		t.Fatalf("late context detail = %#v, want explains-edge ownership", generation.Details[2])
	}
	if len(generation.Events) != 0 {
		t.Fatalf("generation events = %#v, want token chunks excluded from run detail", generation.Events)
	}
	if generation.Artifacts[0].ArtifactID != "artifact_output" {
		t.Fatalf("generation artifacts = %#v", generation.Artifacts)
	}
	var tool *RunDetailNode
	for i := range detail.Root.Children {
		if detail.Root.Children[i].SpanID == "span_tool" {
			tool = &detail.Root.Children[i]
			break
		}
	}
	if tool == nil || tool.Display.Label != "searchDocs" {
		t.Fatalf("tool node = %#v, want semantic tool label", tool)
	}
	if detail.Facets["primitive"]["generation.stream"] != 1 {
		t.Fatalf("facets = %#v", detail.Facets)
	}
}

func TestServiceRunDetailFoldsCompletionOnlySpansAsDetails(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_completion_only","segmentId":"seg_completion_only_a","segmentSeq":1,"traceId":"trace_completion_only","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_completion_only","segmentId":"seg_completion_only_a","segmentSeq":2,"traceId":"trace_completion_only","spanId":"span_agent","family":"agent","primitive":"agent.run","name":"chat","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_orphan_end","type":"span:end","runId":"run_completion_only","segmentId":"seg_completion_only_a","segmentSeq":3,"traceId":"trace_completion_only","spanId":"span_completion_only","endedAt":"2026-05-16T18:00:00.100Z","durationMs":10,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_agent_end","type":"span:end","runId":"run_completion_only","segmentId":"seg_completion_only_a","segmentSeq":4,"traceId":"trace_completion_only","spanId":"span_agent","endedAt":"2026-05-16T18:00:00.200Z","durationMs":199,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_completion_only","segmentId":"seg_completion_only_a","segmentSeq":5,"traceId":"trace_completion_only","endedAt":"2026-05-16T18:00:00.210Z","durationMs":210,"status":"ok"}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_completion_only")
	if err != nil {
		t.Fatal(err)
	}
	if detail.SpanIndex["span_completion_only"].Placement != "detail" {
		t.Fatalf("completion-only placement = %#v, want detail", detail.SpanIndex["span_completion_only"])
	}
	for _, child := range detail.Root.Children {
		if child.SpanID == "span_completion_only" {
			t.Fatalf("completion-only span should not become a visible trace row: %#v", child)
		}
	}
}

func TestServiceRunDetailConsumesGoldenNodeFixture(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := loadGoldenNodeFixture(t)
	runID := batch.Records[0].RunID
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, runID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Root.Display.Label != "chat" {
		t.Fatalf("root label = %q, want chat", detail.Root.Display.Label)
	}
	if detail.SpanIndex["f354f3b6b1e5eeaa"].Placement != "detail" {
		t.Fatalf("prompt placement = %#v, want folded detail", detail.SpanIndex["f354f3b6b1e5eeaa"])
	}
	if detail.SpanIndex["8f3227aa4c6f0565"].Placement != "node" {
		t.Fatalf("parallel placement = %#v, want visible node", detail.SpanIndex["8f3227aa4c6f0565"])
	}
	var parallel *RunDetailNode
	for i := range detail.Root.Children {
		if detail.Root.Children[i].SpanID == "8f3227aa4c6f0565" {
			parallel = &detail.Root.Children[i]
			break
		}
	}
	if parallel == nil {
		t.Fatalf("root children = %#v, want parallel node", detail.Root.Children)
	}
	if len(parallel.Children) != 4 {
		t.Fatalf("parallel children = %d, want 4 sibling research agents", len(parallel.Children))
	}
	if detail.Facets["primitive"]["agent.run"] != 5 {
		t.Fatalf("primitive facets = %#v, want chat + 4 research agents", detail.Facets["primitive"])
	}
}

func TestServiceRunDetailRendersTransitionsWithoutOwningIndentation(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_transition","segmentId":"seg_transition_a","segmentSeq":1,"traceId":"trace_transition","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_transition","segmentId":"seg_transition_a","segmentSeq":2,"traceId":"trace_transition","spanId":"span_chat","family":"agent","primitive":"agent.run","name":"chat","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_tool","type":"span","runId":"run_transition","segmentId":"seg_transition_a","segmentSeq":3,"traceId":"trace_transition","spanId":"span_tool","parentSpanId":"span_chat","family":"tool","primitive":"tool.call","name":"research","toolName":"research","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.020Z","durationMs":10,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_handoff","type":"span","runId":"run_transition","segmentId":"seg_transition_a","segmentSeq":4,"traceId":"trace_transition","spanId":"span_handoff","parentSpanId":"span_chat","family":"handoff","primitive":"handoff.prepare","name":"delegate research","startedAt":"2026-05-16T18:00:00.021Z","endedAt":"2026-05-16T18:00:00.030Z","durationMs":9,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_handoff_input","type":"artifact","runId":"run_transition","segmentId":"seg_transition_a","segmentSeq":5,"traceId":"trace_transition","spanId":"span_handoff","artifactId":"artifact_handoff_input","kind":"input","createdAt":"2026-05-16T18:00:00.022Z","contentType":"application/json","encoding":"json","sizeBytes":13,"preview":{"topic":"ai"},"attributes":{"handoffId":"delegate-research","role":"handoff.input"}}`,
		`{"schemaVersion":2,"recordId":"rec_handoff_payload","type":"artifact","runId":"run_transition","segmentId":"seg_transition_a","segmentSeq":6,"traceId":"trace_transition","spanId":"span_handoff","artifactId":"artifact_handoff_payload","kind":"handoff.payload","createdAt":"2026-05-16T18:00:00.029Z","contentType":"application/json","encoding":"json","sizeBytes":25,"preview":{"handoffId":"delegate-research","data":{"notes":"done"}},"attributes":{"handoffId":"delegate-research","inputSize":13,"outputSize":25}}`,
		`{"schemaVersion":2,"recordId":"rec_research","type":"span","runId":"run_transition","segmentId":"seg_transition_a","segmentSeq":7,"traceId":"trace_transition","spanId":"span_research","parentSpanId":"span_handoff","family":"agent","primitive":"agent.run","name":"research","startedAt":"2026-05-16T18:00:00.031Z","endedAt":"2026-05-16T18:00:01.000Z","durationMs":969,"status":"ok","agentId":"research"}`,
		`{"schemaVersion":2,"recordId":"rec_edge_delegate","type":"edge","runId":"run_transition","segmentId":"seg_transition_a","segmentSeq":8,"traceId":"trace_transition","edgeId":"edge_delegate","edgeType":"delegate.invoked","from":{"kind":"span","id":"span_handoff"},"to":{"kind":"span","id":"span_research"},"createdAt":"2026-05-16T18:00:00.031Z"}`,
		`{"schemaVersion":2,"recordId":"rec_agent_end","type":"span:end","runId":"run_transition","segmentId":"seg_transition_a","segmentSeq":9,"traceId":"trace_transition","spanId":"span_chat","endedAt":"2026-05-16T18:00:01.010Z","durationMs":1009,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_transition","segmentId":"seg_transition_a","segmentSeq":10,"traceId":"trace_transition","endedAt":"2026-05-16T18:00:01.020Z","durationMs":1020,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_transition")
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Root.Children) != 3 {
		t.Fatalf("root children = %#v, want tool, handoff, research siblings", detail.Root.Children)
	}
	if detail.Root.Children[1].SpanID != "span_handoff" || detail.Root.Children[1].Display.Kind != "transition" {
		t.Fatalf("handoff node = %#v", detail.Root.Children[1])
	}
	if len(detail.Root.Children[1].Children) != 0 {
		t.Fatalf("handoff children = %#v, want no visual indentation", detail.Root.Children[1].Children)
	}
	if detail.Root.Children[2].SpanID != "span_research" || detail.Root.Children[2].ParentID != detail.Root.ID {
		t.Fatalf("research node = %#v, want sibling under run root", detail.Root.Children[2])
	}
	if len(detail.Root.Children[1].Relations) != 1 || len(detail.Root.Children[2].Relations) != 1 {
		t.Fatalf("handoff/research relations = %#v / %#v", detail.Root.Children[1].Relations, detail.Root.Children[2].Relations)
	}
	if len(detail.Root.Children[1].Inspection["input"]) != 1 {
		t.Fatalf("handoff input inspection = %#v, want input artifact", detail.Root.Children[1].Inspection)
	}
	if len(detail.Root.Children[1].Inspection["output"]) != 1 {
		t.Fatalf("handoff output inspection = %#v, want handoff payload artifact", detail.Root.Children[1].Inspection)
	}
}

func TestServiceRunDetailFoldsConvexBoundaryAndKeepsChildFlowVisible(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_convex_boundary","segmentId":"seg_convex_boundary_a","segmentSeq":1,"traceId":"trace_convex_boundary","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_convex_boundary","segmentId":"seg_convex_boundary_a","segmentSeq":2,"traceId":"trace_convex_boundary","spanId":"span_chat","family":"agent","primitive":"agent.run","name":"chat","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_tool","type":"span","runId":"run_convex_boundary","segmentId":"seg_convex_boundary_a","segmentSeq":3,"traceId":"trace_convex_boundary","spanId":"span_tool","parentSpanId":"span_chat","family":"tool","primitive":"tool.call","name":"research","toolName":"research","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.020Z","durationMs":10,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_delegate","type":"span","runId":"run_convex_boundary","segmentId":"seg_convex_boundary_a","segmentSeq":4,"traceId":"trace_convex_boundary","spanId":"span_delegate","parentSpanId":"span_tool","family":"delegate","primitive":"delegate.invoke","name":"delegate-research","startedAt":"2026-05-16T18:00:00.021Z","endedAt":"2026-05-16T18:00:00.030Z","durationMs":9,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_fanout","type":"span","runId":"run_convex_boundary","segmentId":"seg_convex_boundary_a","segmentSeq":5,"traceId":"trace_convex_boundary","spanId":"span_fanout","parentSpanId":"span_delegate","family":"composition","primitive":"composition.parallel","name":"research fanout","startedAt":"2026-05-16T18:00:00.031Z","endedAt":"2026-05-16T18:00:00.040Z","durationMs":9,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_boundary","type":"span","runId":"run_convex_boundary","segmentId":"seg_convex_boundary_a","segmentSeq":6,"traceId":"trace_convex_boundary","spanId":"span_boundary","parentSpanId":"span_fanout","family":"runtime","primitive":"runtime.convex.action","name":"research","startedAt":"2026-05-16T18:00:00.041Z","endedAt":"2026-05-16T18:00:01.000Z","durationMs":959,"status":"ok","attributes":{"boundary":"convex.action","presentation":{"display":"detail"}}}`,
		`{"schemaVersion":2,"recordId":"rec_flow","type":"span","runId":"run_convex_boundary","segmentId":"seg_convex_boundary_a","segmentSeq":7,"traceId":"trace_convex_boundary","spanId":"span_research_flow","parentSpanId":"span_boundary","family":"flow","primitive":"flow.run","name":"research","startedAt":"2026-05-16T18:00:00.042Z","endedAt":"2026-05-16T18:00:01.000Z","durationMs":958,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_step","type":"span","runId":"run_convex_boundary","segmentId":"seg_convex_boundary_a","segmentSeq":8,"traceId":"trace_convex_boundary","spanId":"span_research_step","parentSpanId":"span_research_flow","family":"flow","primitive":"flow.step","name":"plan","startedAt":"2026-05-16T18:00:00.043Z","endedAt":"2026-05-16T18:00:00.500Z","durationMs":457,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_convex_boundary","segmentId":"seg_convex_boundary_a","segmentSeq":9,"traceId":"trace_convex_boundary","spanId":"span_generate","parentSpanId":"span_research_step","family":"generation","primitive":"generation.call","name":"generate research-planner","startedAt":"2026-05-16T18:00:00.044Z","endedAt":"2026-05-16T18:00:00.400Z","durationMs":356,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_agent_end","type":"span:end","runId":"run_convex_boundary","segmentId":"seg_convex_boundary_a","segmentSeq":10,"traceId":"trace_convex_boundary","spanId":"span_chat","endedAt":"2026-05-16T18:00:01.010Z","durationMs":1009,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_convex_boundary","segmentId":"seg_convex_boundary_a","segmentSeq":11,"traceId":"trace_convex_boundary","endedAt":"2026-05-16T18:00:01.020Z","durationMs":1020,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_convex_boundary")
	if err != nil {
		t.Fatal(err)
	}

	fanout := findRunDetailNode(&detail.Root, "span_fanout")
	if fanout == nil {
		t.Fatalf("tree = %#v, want fanout node", detail.Root)
	}
	if len(fanout.Children) != 1 || fanout.Children[0].SpanID != "span_research_flow" {
		t.Fatalf("fanout children = %#v, want research flow child", fanout.Children)
	}
	if len(fanout.Children[0].Details) != 1 || fanout.Children[0].Details[0].SpanID != "span_boundary" {
		t.Fatalf("research flow details = %#v, want folded convex boundary detail", fanout.Children[0].Details)
	}
	if detail.SpanIndex["span_boundary"].Placement != "detail" {
		t.Fatalf("boundary placement = %#v, want detail", detail.SpanIndex["span_boundary"])
	}
	if detail.SpanIndex["span_research_flow"].Placement != "node" {
		t.Fatalf("research flow placement = %#v, want node", detail.SpanIndex["span_research_flow"])
	}
}

func TestServiceRunDetailReconcilesMissingConvexBoundaryEndFromChildAck(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_convex_ack","segmentId":"seg_convex_ack_a","segmentSeq":1,"traceId":"trace_convex_ack","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_convex_ack","segmentId":"seg_convex_ack_a","segmentSeq":2,"traceId":"trace_convex_ack","spanId":"span_chat","family":"agent","primitive":"agent.run","name":"chat","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_tool","type":"span","runId":"run_convex_ack","segmentId":"seg_convex_ack_a","segmentSeq":3,"traceId":"trace_convex_ack","spanId":"span_tool","parentSpanId":"span_chat","family":"tool","primitive":"tool.call","name":"writer","toolName":"writer","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:01.020Z","durationMs":1010,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_boundary_start","type":"span:start","runId":"run_convex_ack","segmentId":"seg_convex_ack_a","segmentSeq":4,"traceId":"trace_convex_ack","spanId":"span_boundary","parentSpanId":"span_tool","family":"runtime","primitive":"runtime.convex.action","name":"writer","startedAt":"2026-05-16T18:00:00.020Z","status":"running","attributes":{"boundary":"convex.action","presentation":{"display":"detail"}}}`,
		`{"schemaVersion":2,"recordId":"rec_flow","type":"span","runId":"run_convex_ack","segmentId":"seg_convex_ack_a","segmentSeq":5,"traceId":"trace_convex_ack","spanId":"span_writer_flow","parentSpanId":"span_boundary","family":"flow","primitive":"flow.run","name":"writer-quick","startedAt":"2026-05-16T18:00:00.021Z","endedAt":"2026-05-16T18:00:01.000Z","durationMs":979,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_boundary_done","type":"span:event","runId":"run_convex_ack","segmentId":"seg_convex_ack_a","segmentSeq":6,"traceId":"trace_convex_ack","spanId":"span_boundary","eventId":"event_boundary_done","name":"runtime.convex.boundary.completed","timestamp":"2026-05-16T18:00:01.005Z","attributes":{"boundaryId":"span_boundary","boundarySpanId":"span_boundary","status":"ok"}}`,
		`{"schemaVersion":2,"recordId":"rec_agent_end","type":"span:end","runId":"run_convex_ack","segmentId":"seg_convex_ack_a","segmentSeq":7,"traceId":"trace_convex_ack","spanId":"span_chat","endedAt":"2026-05-16T18:00:01.030Z","durationMs":1029,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_convex_ack","segmentId":"seg_convex_ack_a","segmentSeq":8,"traceId":"trace_convex_ack","endedAt":"2026-05-16T18:00:01.040Z","durationMs":1040,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_convex_ack")
	if err != nil {
		t.Fatal(err)
	}

	flow := findRunDetailNode(&detail.Root, "span_writer_flow")
	if flow == nil {
		t.Fatalf("tree = %#v, want writer flow node", detail.Root)
	}
	if len(flow.Details) != 1 || flow.Details[0].SpanID != "span_boundary" {
		t.Fatalf("writer flow details = %#v, want reconciled boundary detail", flow.Details)
	}
	boundary := flow.Details[0]
	if boundary.Status != "ok" || boundary.Timing.EndedAt != "2026-05-16T18:00:01.005Z" || boundary.Timing.DurationMs != 985 {
		t.Fatalf("boundary detail = %#v, want status ok and timing from child ack", boundary)
	}
	if diagnostics := boundary.Diagnostics; len(diagnostics) != 0 {
		t.Fatalf("boundary diagnostics = %#v, want no missing-span-end diagnostics after ack reconciliation", diagnostics)
	}
}

func TestServiceRunDetailReconcilesMissingParentEndsFromTerminalChildren(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_parent_reconcile","segmentId":"seg_parent_reconcile_a","segmentSeq":1,"traceId":"trace_parent_reconcile","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_parent_reconcile","segmentId":"seg_parent_reconcile_a","segmentSeq":2,"traceId":"trace_parent_reconcile","spanId":"span_chat","family":"agent","primitive":"agent.run","name":"chat","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_parent_reconcile","segmentId":"seg_parent_reconcile_a","segmentSeq":3,"traceId":"trace_parent_reconcile","spanId":"span_generate","parentSpanId":"span_chat","family":"generation","primitive":"generation.stream","name":"stream Support Agent","startedAt":"2026-05-16T18:00:00.002Z","endedAt":"2026-05-16T18:00:00.100Z","durationMs":98,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_tool","type":"span:start","runId":"run_parent_reconcile","segmentId":"seg_parent_reconcile_a","segmentSeq":4,"traceId":"trace_parent_reconcile","spanId":"span_tool","parentSpanId":"span_chat","family":"tool","primitive":"tool.call","name":"writer","toolName":"writer","startedAt":"2026-05-16T18:00:00.110Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_boundary_start","type":"span:start","runId":"run_parent_reconcile","segmentId":"seg_parent_reconcile_a","segmentSeq":5,"traceId":"trace_parent_reconcile","spanId":"span_boundary","parentSpanId":"span_tool","family":"runtime","primitive":"runtime.convex.action","name":"writer","startedAt":"2026-05-16T18:00:00.120Z","status":"running","attributes":{"boundary":"convex.action","presentation":{"display":"detail"}}}`,
		`{"schemaVersion":2,"recordId":"rec_flow","type":"span","runId":"run_parent_reconcile","segmentId":"seg_parent_reconcile_a","segmentSeq":6,"traceId":"trace_parent_reconcile","spanId":"span_writer_flow","parentSpanId":"span_boundary","family":"flow","primitive":"flow.run","name":"writer-quick","startedAt":"2026-05-16T18:00:00.130Z","endedAt":"2026-05-16T18:00:01.000Z","durationMs":870,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_boundary_done","type":"span:event","runId":"run_parent_reconcile","segmentId":"seg_parent_reconcile_a","segmentSeq":7,"traceId":"trace_parent_reconcile","spanId":"span_boundary","eventId":"event_boundary_done","name":"runtime.convex.boundary.completed","timestamp":"2026-05-16T18:00:01.005Z","attributes":{"boundaryId":"span_boundary","boundarySpanId":"span_boundary","status":"ok"}}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_parent_reconcile")
	if err != nil {
		t.Fatal(err)
	}

	tool := findRunDetailNode(&detail.Root, "span_tool")
	if tool == nil {
		t.Fatalf("tree = %#v, want writer tool node", detail.Root)
	}
	if tool.Status != "ok" || tool.Timing.EndedAt != "2026-05-16T18:00:01.005Z" {
		t.Fatalf("tool = %#v, want reconciled ok at child boundary completion", tool)
	}
	if detail.Root.Status != "ok" || detail.Root.Timing.EndedAt != "2026-05-16T18:00:01.005Z" {
		t.Fatalf("root = %#v, want reconciled ok from terminal children", detail.Root)
	}
	if detail.Run.Status != "ok" || detail.Run.EndedAt != "2026-05-16T18:00:01.005Z" {
		t.Fatalf("run = %#v, want reconciled ok from terminal roots", detail.Run)
	}
	if len(detail.Diagnostics) != 0 {
		t.Fatalf("diagnostics = %#v, want no stale diagnostics", detail.Diagnostics)
	}
}

func TestServiceRunDetailReconcilesExpiredConvexBoundaryLease(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	started := time.Now().Add(-3 * time.Minute).UTC()
	expiresAt := started.Add(90 * time.Second).UTC()
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_boundary_lease","segmentId":"seg_boundary_lease_a","segmentSeq":1,"traceId":"trace_boundary_lease","name":"chat","rootPrimitive":"agent.run","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_boundary_lease","segmentId":"seg_boundary_lease_a","segmentSeq":2,"traceId":"trace_boundary_lease","spanId":"span_chat","family":"agent","primitive":"agent.run","name":"chat","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_boundary","type":"span:start","runId":"run_boundary_lease","segmentId":"seg_boundary_lease_a","segmentSeq":3,"traceId":"trace_boundary_lease","spanId":"span_boundary","parentSpanId":"span_chat","family":"runtime","primitive":"runtime.convex.action","name":"writer","startedAt":"`+started.Add(time.Second).Format(time.RFC3339Nano)+`","status":"running","attributes":{"boundary":"convex.action","presentation":{"display":"detail"}}}`,
		`{"schemaVersion":2,"recordId":"rec_boundary_requested","type":"span:event","runId":"run_boundary_lease","segmentId":"seg_boundary_lease_a","segmentSeq":4,"traceId":"trace_boundary_lease","spanId":"span_boundary","eventId":"event_boundary_requested","name":"runtime.convex.boundary.requested","timestamp":"`+started.Add(time.Second).Format(time.RFC3339Nano)+`","attributes":{"boundaryId":"span_boundary","boundarySpanId":"span_boundary","leaseExpiresAt":"`+expiresAt.Format(time.RFC3339Nano)+`"}}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_boundary_lease")
	if err != nil {
		t.Fatal(err)
	}
	boundary := findRunDetailDetail(&detail.Root, "span_boundary")
	if boundary == nil {
		t.Fatalf("tree = %#v, want boundary detail", detail.Root)
	}
	if boundary.Status != "stale" || boundary.Timing.EndedAt != expiresAt.Format(time.RFC3339Nano) {
		t.Fatalf("boundary = %#v, want stale at lease expiry", boundary)
	}
	if len(boundary.Diagnostics) == 0 || boundary.Diagnostics[0].Code != "convex-boundary-lease-expired" {
		t.Fatalf("boundary diagnostics = %#v, want lease diagnostic", boundary.Diagnostics)
	}
}

func findRunDetailDetail(node *RunDetailNode, spanID string) *RunDetailDetail {
	for i := range node.Details {
		if node.Details[i].SpanID == spanID {
			return &node.Details[i]
		}
	}
	for i := range node.Children {
		if found := findRunDetailDetail(&node.Children[i], spanID); found != nil {
			return found
		}
	}
	return nil
}

func findRunDetailNode(node *RunDetailNode, spanID string) *RunDetailNode {
	if node.SpanID == spanID {
		return node
	}
	for i := range node.Children {
		if found := findRunDetailNode(&node.Children[i], spanID); found != nil {
			return found
		}
	}
	return nil
}

func TestServiceRunDetailKeepsManyToManyRelationsAsOverlays(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_relations","segmentId":"seg_relations_a","segmentSeq":1,"traceId":"trace_relations","name":"relations","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_relations","segmentId":"seg_relations_a","segmentSeq":2,"traceId":"trace_relations","spanId":"span_agent","family":"agent","primitive":"agent.run","name":"agent","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_retrieve_a","type":"span","runId":"run_relations","segmentId":"seg_relations_a","segmentSeq":3,"traceId":"trace_relations","spanId":"span_retrieve_a","parentSpanId":"span_agent","family":"retrieval","primitive":"retrieval.query","name":"retrieve A","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.020Z","durationMs":10,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_retrieve_b","type":"span","runId":"run_relations","segmentId":"seg_relations_a","segmentSeq":4,"traceId":"trace_relations","spanId":"span_retrieve_b","parentSpanId":"span_agent","family":"retrieval","primitive":"retrieval.query","name":"retrieve B","startedAt":"2026-05-16T18:00:00.021Z","endedAt":"2026-05-16T18:00:00.030Z","durationMs":9,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_relations","segmentId":"seg_relations_a","segmentSeq":5,"traceId":"trace_relations","spanId":"span_generate","parentSpanId":"span_agent","family":"generation","primitive":"generation.call","name":"generate","startedAt":"2026-05-16T18:00:00.040Z","endedAt":"2026-05-16T18:00:01.000Z","durationMs":960,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_edge_a","type":"edge","runId":"run_relations","segmentId":"seg_relations_a","segmentSeq":6,"traceId":"trace_relations","edgeId":"edge_a","edgeType":"retrieval.returned","from":{"kind":"span","id":"span_retrieve_a"},"to":{"kind":"span","id":"span_generate"},"createdAt":"2026-05-16T18:00:00.040Z"}`,
		`{"schemaVersion":2,"recordId":"rec_edge_b","type":"edge","runId":"run_relations","segmentId":"seg_relations_a","segmentSeq":7,"traceId":"trace_relations","edgeId":"edge_b","edgeType":"retrieval.returned","from":{"kind":"span","id":"span_retrieve_b"},"to":{"kind":"span","id":"span_generate"},"createdAt":"2026-05-16T18:00:00.041Z"}`,
		`{"schemaVersion":2,"recordId":"rec_agent_end","type":"span:end","runId":"run_relations","segmentId":"seg_relations_a","segmentSeq":8,"traceId":"trace_relations","spanId":"span_agent","endedAt":"2026-05-16T18:00:01.010Z","durationMs":1009,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_relations","segmentId":"seg_relations_a","segmentSeq":9,"traceId":"trace_relations","endedAt":"2026-05-16T18:00:01.020Z","durationMs":1020,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_relations")
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Root.Children) != 3 {
		t.Fatalf("root children = %#v, want two retrieval nodes and one generation node", detail.Root.Children)
	}
	generation := detail.Root.Children[2]
	if generation.SpanID != "span_generate" || len(generation.Relations) != 2 {
		t.Fatalf("generation relations = %#v", generation.Relations)
	}
	if detail.SpanIndex["span_retrieve_a"].Placement != "node" || detail.SpanIndex["span_retrieve_b"].Placement != "node" {
		t.Fatalf("retrieval placements = %#v / %#v", detail.SpanIndex["span_retrieve_a"], detail.SpanIndex["span_retrieve_b"])
	}
}

func TestServiceRunDetailPresentsToolExecutionInsideStreamContainer(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_agent_timeline","segmentId":"seg_agent_timeline_a","segmentSeq":1,"traceId":"trace_agent_timeline","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_agent_timeline","segmentId":"seg_agent_timeline_a","segmentSeq":2,"traceId":"trace_agent_timeline","spanId":"span_agent","family":"agent","primitive":"agent.run","name":"chat","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_agent_timeline","segmentId":"seg_agent_timeline_a","segmentSeq":3,"traceId":"trace_agent_timeline","spanId":"span_generate","parentSpanId":"span_agent","family":"generation","primitive":"generation.stream","name":"stream chat","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:01.000Z","durationMs":990,"status":"ok","metrics":{"inputTokens":10,"outputTokens":20,"totalTokens":30,"costUsd":0.01}}`,
		`{"schemaVersion":2,"recordId":"rec_request","type":"artifact","runId":"run_agent_timeline","segmentId":"seg_agent_timeline_a","segmentSeq":4,"traceId":"trace_agent_timeline","spanId":"span_generate","artifactId":"artifact_tool_request","kind":"tool.request","createdAt":"2026-05-16T18:00:00.900Z","contentType":"application/json","encoding":"json","sizeBytes":32,"preview":{"toolName":"writer","toolCallId":"call_writer","args":{"instruction":"draft"}},"attributes":{"toolName":"writer","toolCallId":"call_writer"}}`,
		`{"schemaVersion":2,"recordId":"rec_tool","type":"span","runId":"run_agent_timeline","segmentId":"seg_agent_timeline_a","segmentSeq":5,"traceId":"trace_agent_timeline","spanId":"span_tool","parentSpanId":"span_generate","family":"tool","primitive":"tool.call","name":"writer","toolName":"writer","startedAt":"2026-05-16T18:00:01.010Z","endedAt":"2026-05-16T18:00:01.110Z","durationMs":100,"status":"ok","metrics":{"costUsd":0.02},"attributes":{"toolName":"writer","toolCallId":"call_writer"}}`,
		`{"schemaVersion":2,"recordId":"rec_args","type":"artifact","runId":"run_agent_timeline","segmentId":"seg_agent_timeline_a","segmentSeq":6,"traceId":"trace_agent_timeline","spanId":"span_tool","artifactId":"artifact_tool_args","kind":"tool.args","createdAt":"2026-05-16T18:00:01.020Z","contentType":"application/json","encoding":"json","sizeBytes":24,"preview":{"instruction":"draft"},"attributes":{"toolName":"writer","toolCallId":"call_writer"}}`,
		`{"schemaVersion":2,"recordId":"rec_result","type":"artifact","runId":"run_agent_timeline","segmentId":"seg_agent_timeline_a","segmentSeq":7,"traceId":"trace_agent_timeline","spanId":"span_tool","artifactId":"artifact_tool_result","kind":"tool.result","createdAt":"2026-05-16T18:00:01.100Z","contentType":"application/json","encoding":"json","sizeBytes":18,"preview":{"ok":true},"attributes":{"toolName":"writer","toolCallId":"call_writer"}}`,
		`{"schemaVersion":2,"recordId":"rec_called","type":"edge","runId":"run_agent_timeline","segmentId":"seg_agent_timeline_a","segmentSeq":8,"traceId":"trace_agent_timeline","edgeId":"edge_called","edgeType":"called","from":{"kind":"span","id":"span_generate"},"to":{"kind":"span","id":"span_tool"},"createdAt":"2026-05-16T18:00:01.010Z","attributes":{"toolCallId":"call_writer"}}`,
		`{"schemaVersion":2,"recordId":"rec_agent_end","type":"span:end","runId":"run_agent_timeline","segmentId":"seg_agent_timeline_a","segmentSeq":9,"traceId":"trace_agent_timeline","spanId":"span_agent","endedAt":"2026-05-16T18:00:01.200Z","durationMs":1199,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_agent_timeline","segmentId":"seg_agent_timeline_a","segmentSeq":10,"traceId":"trace_agent_timeline","endedAt":"2026-05-16T18:00:01.210Z","durationMs":1210,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_agent_timeline")
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Root.Children) != 1 {
		t.Fatalf("agent children = %#v, want stream container", detail.Root.Children)
	}
	stream := detail.Root.Children[0]
	if stream.SpanID != "span_generate" {
		t.Fatalf("agent timeline = %#v", detail.Root.Children)
	}
	if len(stream.Children) != 1 || stream.Children[0].SpanID != "span_tool" {
		t.Fatalf("stream children = %#v, want tool child", stream.Children)
	}
	if stream.Children[0].Source.CanonicalParentSpanID != "span_generate" {
		t.Fatalf("tool canonical parent source = %#v", stream.Children[0].Source)
	}
	if detail.Root.MetricBuckets.Total == nil {
		t.Fatalf("root metric buckets missing total")
	}
	var total map[string]float64
	if err := json.Unmarshal(detail.Root.MetricBuckets.Total, &total); err != nil {
		t.Fatal(err)
	}
	if total["totalTokens"] != 30 || total["costUsd"] != 0.03 {
		t.Fatalf("root total metrics = %#v, want rolled up generation + tool metrics", total)
	}
	if len(stream.Inspection["tools"]) == 0 {
		t.Fatalf("generation inspection tools = %#v, want tool.request artifact", stream.Inspection)
	}
	toolInspection := stream.Children[0].Inspection["tools"]
	if len(toolInspection) != 3 {
		t.Fatalf("tool inspection tools = %#v, want request + args + result", stream.Children[0].Inspection)
	}
	kinds := map[string]bool{}
	for _, item := range toolInspection {
		kinds[item.Kind] = true
	}
	for _, kind := range []string{"tool.request", "tool.args", "tool.result"} {
		if !kinds[kind] {
			t.Fatalf("tool inspection kinds = %#v, missing %s", kinds, kind)
		}
	}
}

func TestServiceRunDetailKeepsUsefulConvexAgentStreamContainer(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_convex_agent_timeline","segmentId":"seg_convex_agent_timeline_a","segmentSeq":1,"traceId":"trace_convex_agent_timeline","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_convex_agent_timeline","segmentId":"seg_convex_agent_timeline_a","segmentSeq":2,"traceId":"trace_convex_agent_timeline","spanId":"span_agent","family":"agent","primitive":"agent.run","name":"chat","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_stream","type":"span","runId":"run_convex_agent_timeline","segmentId":"seg_convex_agent_timeline_a","segmentSeq":3,"traceId":"trace_convex_agent_timeline","spanId":"span_stream","parentSpanId":"span_agent","family":"generation","primitive":"generation.stream","name":"stream response","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:03.000Z","durationMs":2990,"status":"ok","attributes":{"finish":"stream"}}`,
		`{"schemaVersion":2,"recordId":"rec_step_1","type":"span","runId":"run_convex_agent_timeline","segmentId":"seg_convex_agent_timeline_a","segmentSeq":4,"traceId":"trace_convex_agent_timeline","spanId":"span_step_1","parentSpanId":"span_stream","family":"generation","primitive":"generation.call","name":"step 1","startedAt":"2026-05-16T18:00:00.020Z","endedAt":"2026-05-16T18:00:00.900Z","durationMs":880,"status":"ok","attributes":{"source":"convex.agent.step","mode":"stream","stepNumber":0,"finishReason":"tool-calls"},"metrics":{"totalTokens":30}}`,
		`{"schemaVersion":2,"recordId":"rec_request","type":"artifact","runId":"run_convex_agent_timeline","segmentId":"seg_convex_agent_timeline_a","segmentSeq":5,"traceId":"trace_convex_agent_timeline","spanId":"span_step_1","artifactId":"artifact_tool_request","kind":"tool.request","createdAt":"2026-05-16T18:00:00.880Z","contentType":"application/json","encoding":"json","sizeBytes":32,"preview":{"toolName":"research","toolCallId":"call_research","args":{"query":"x"}},"attributes":{"toolName":"research","toolCallId":"call_research"}}`,
		`{"schemaVersion":2,"recordId":"rec_tool","type":"span","runId":"run_convex_agent_timeline","segmentId":"seg_convex_agent_timeline_a","segmentSeq":6,"traceId":"trace_convex_agent_timeline","spanId":"span_tool","parentSpanId":"span_stream","family":"tool","primitive":"tool.call","name":"research","toolName":"research","startedAt":"2026-05-16T18:00:00.015Z","endedAt":"2026-05-16T18:00:02.000Z","durationMs":1985,"status":"ok","attributes":{"toolName":"research","toolCallId":"call_research"}}`,
		`{"schemaVersion":2,"recordId":"rec_step_2","type":"span","runId":"run_convex_agent_timeline","segmentId":"seg_convex_agent_timeline_a","segmentSeq":7,"traceId":"trace_convex_agent_timeline","spanId":"span_step_2","parentSpanId":"span_stream","family":"generation","primitive":"generation.call","name":"step 2","startedAt":"2026-05-16T18:00:02.100Z","endedAt":"2026-05-16T18:00:02.900Z","durationMs":800,"status":"ok","attributes":{"source":"convex.agent.step","mode":"stream","stepNumber":1,"finishReason":"stop"},"metrics":{"totalTokens":40}}`,
		`{"schemaVersion":2,"recordId":"rec_agent_end","type":"span:end","runId":"run_convex_agent_timeline","segmentId":"seg_convex_agent_timeline_a","segmentSeq":8,"traceId":"trace_convex_agent_timeline","spanId":"span_agent","endedAt":"2026-05-16T18:00:03.100Z","durationMs":3099,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_convex_agent_timeline","segmentId":"seg_convex_agent_timeline_a","segmentSeq":9,"traceId":"trace_convex_agent_timeline","endedAt":"2026-05-16T18:00:03.110Z","durationMs":3110,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_convex_agent_timeline")
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Root.Children) != 1 {
		t.Fatalf("agent children = %#v, want visible stream response container", detail.Root.Children)
	}
	stream := detail.Root.Children[0]
	if stream.SpanID != "span_stream" {
		t.Fatalf("agent child = %q, want stream container; children=%#v", stream.SpanID, detail.Root.Children)
	}
	want := []string{"span_step_1", "span_tool", "span_step_2"}
	for i, spanID := range want {
		if stream.Children[i].SpanID != spanID {
			t.Fatalf("stream timeline child %d = %q, want %q; children=%#v", i, stream.Children[i].SpanID, spanID, stream.Children)
		}
		if stream.Children[i].Source.CanonicalParentSpanID != "span_stream" {
			t.Fatalf("child %s canonical parent source = %#v", spanID, stream.Children[i].Source)
		}
	}
	if detail.SpanIndex["span_stream"].Placement != "node" {
		t.Fatalf("stream placement = %#v, want visible node", detail.SpanIndex["span_stream"])
	}
	if detail.SpanIndex["span_step_1"].Placement != "node" || detail.SpanIndex["span_step_2"].Placement != "node" {
		t.Fatalf("step placements = %#v / %#v", detail.SpanIndex["span_step_1"], detail.SpanIndex["span_step_2"])
	}
	if len(stream.Children[0].Inspection["tools"]) == 0 {
		t.Fatalf("step generation tools = %#v, want tool.request inspection", stream.Children[0].Inspection)
	}
}

func TestServiceRunDetailFoldsRedundantConvexAgentStreamContainer(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_redundant_stream","segmentId":"seg_redundant_stream_a","segmentSeq":1,"traceId":"trace_redundant_stream","name":"chat","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_redundant_stream","segmentId":"seg_redundant_stream_a","segmentSeq":2,"traceId":"trace_redundant_stream","spanId":"span_agent","family":"agent","primitive":"agent.run","name":"chat","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_stream","type":"span","runId":"run_redundant_stream","segmentId":"seg_redundant_stream_a","segmentSeq":3,"traceId":"trace_redundant_stream","spanId":"span_stream","parentSpanId":"span_agent","family":"generation","primitive":"generation.stream","name":"stream response","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:01.000Z","durationMs":990,"status":"ok","attributes":{"finish":"stream"}}`,
		`{"schemaVersion":2,"recordId":"rec_step","type":"span","runId":"run_redundant_stream","segmentId":"seg_redundant_stream_a","segmentSeq":4,"traceId":"trace_redundant_stream","spanId":"span_step","parentSpanId":"span_stream","family":"generation","primitive":"generation.call","name":"step 1","startedAt":"2026-05-16T18:00:00.020Z","endedAt":"2026-05-16T18:00:00.900Z","durationMs":880,"status":"ok","attributes":{"source":"convex.agent.step","mode":"stream","stepNumber":0,"finishReason":"stop"},"metrics":{"totalTokens":30}}`,
		`{"schemaVersion":2,"recordId":"rec_agent_end","type":"span:end","runId":"run_redundant_stream","segmentId":"seg_redundant_stream_a","segmentSeq":5,"traceId":"trace_redundant_stream","spanId":"span_agent","endedAt":"2026-05-16T18:00:01.100Z","durationMs":1099,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_redundant_stream","segmentId":"seg_redundant_stream_a","segmentSeq":6,"traceId":"trace_redundant_stream","endedAt":"2026-05-16T18:00:01.110Z","durationMs":1110,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_redundant_stream")
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Root.Children) != 1 || detail.Root.Children[0].SpanID != "span_step" {
		t.Fatalf("agent children = %#v, want folded stream with step child", detail.Root.Children)
	}
	if detail.SpanIndex["span_stream"].Placement != "detail" {
		t.Fatalf("stream placement = %#v, want folded detail", detail.SpanIndex["span_stream"])
	}
}

func TestServiceRunDetailRendersFlowSuspensionAsTimelineMarker(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_flow_suspend_marker","segmentId":"seg_flow_suspend_marker_a","segmentSeq":1,"traceId":"trace_flow_suspend_marker","name":"writer","rootPrimitive":"flow.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_flow","type":"span","runId":"run_flow_suspend_marker","segmentId":"seg_flow_suspend_marker_a","segmentSeq":2,"traceId":"trace_flow_suspend_marker","spanId":"span_flow","family":"flow","primitive":"flow.run","name":"writer","startedAt":"2026-05-16T18:00:00.001Z","endedAt":"2026-05-16T18:00:02.000Z","durationMs":1999,"status":"suspended"}`,
		`{"schemaVersion":2,"recordId":"rec_step","type":"span","runId":"run_flow_suspend_marker","segmentId":"seg_flow_suspend_marker_a","segmentSeq":3,"traceId":"trace_flow_suspend_marker","spanId":"span_step_plan","parentSpanId":"span_flow","family":"flow","primitive":"flow.step","name":"plan","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:01.010Z","durationMs":1000,"status":"ok","stepId":"plan"}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_flow_suspend_marker","segmentId":"seg_flow_suspend_marker_a","segmentSeq":4,"traceId":"trace_flow_suspend_marker","spanId":"span_generate_plan","parentSpanId":"span_step_plan","family":"generation","primitive":"generation.call","name":"generate writer-propose-plan","startedAt":"2026-05-16T18:00:00.020Z","endedAt":"2026-05-16T18:00:00.920Z","durationMs":900,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_suspend","type":"span","runId":"run_flow_suspend_marker","segmentId":"seg_flow_suspend_marker_a","segmentSeq":5,"traceId":"trace_flow_suspend_marker","spanId":"span_suspend_plan","parentSpanId":"span_step_plan","family":"flow","primitive":"flow.suspension","name":"plan-approval","startedAt":"2026-05-16T18:00:01.011Z","endedAt":"2026-05-16T18:00:01.011Z","durationMs":0,"status":"suspended","attributes":{"causedByStepId":"plan","resumeTarget":"writer.resume"}}`,
		`{"schemaVersion":2,"recordId":"rec_edge","type":"edge","runId":"run_flow_suspend_marker","segmentId":"seg_flow_suspend_marker_a","segmentSeq":6,"traceId":"trace_flow_suspend_marker","edgeId":"edge_suspend_caused","edgeType":"caused","from":{"kind":"span","id":"span_step_plan"},"to":{"kind":"span","id":"span_suspend_plan"},"createdAt":"2026-05-16T18:00:01.011Z"}`,
		`{"schemaVersion":2,"recordId":"rec_run_suspend","type":"run:suspend","runId":"run_flow_suspend_marker","segmentId":"seg_flow_suspend_marker_a","segmentSeq":7,"traceId":"trace_flow_suspend_marker","suspendedAt":"2026-05-16T18:00:02.000Z","reason":"plan-approval"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_flow_suspend_marker")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Root.Status != "suspended" {
		t.Fatalf("root status = %q, want suspended", detail.Root.Status)
	}
	if len(detail.Root.Children) != 2 {
		t.Fatalf("flow children = %#v, want step and suspension siblings", detail.Root.Children)
	}
	if detail.Root.Children[0].SpanID != "span_step_plan" || detail.Root.Children[0].Status != "ok" {
		t.Fatalf("plan step = %#v, want ok step", detail.Root.Children[0])
	}
	if detail.Root.Children[1].SpanID != "span_suspend_plan" || detail.Root.Children[1].Kind != "suspension" {
		t.Fatalf("suspension marker = %#v", detail.Root.Children[1])
	}
	if detail.Root.Children[1].Source.CanonicalParentSpanID != "span_step_plan" {
		t.Fatalf("suspension source = %#v", detail.Root.Children[1].Source)
	}
}

func TestServiceRunDetailFoldsQuietGovernanceAndRetrievalStages(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":1,"traceId":"trace_governance_retrieval","name":"answer","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":2,"traceId":"trace_governance_retrieval","spanId":"span_agent","family":"agent","primitive":"agent.run","name":"agent","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_retrieval","type":"span","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":3,"traceId":"trace_governance_retrieval","spanId":"span_retrieval","parentSpanId":"span_agent","family":"retrieval","primitive":"retrieval.query","name":"knowledge.search","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.110Z","durationMs":100,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_stage","type":"span","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":4,"traceId":"trace_governance_retrieval","spanId":"span_stage","parentSpanId":"span_retrieval","family":"retrieval","primitive":"retrieval.stage","name":"rerank","startedAt":"2026-05-16T18:00:00.020Z","endedAt":"2026-05-16T18:00:00.080Z","durationMs":60,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":5,"traceId":"trace_governance_retrieval","spanId":"span_generate","parentSpanId":"span_agent","family":"generation","primitive":"generation.call","name":"generate","startedAt":"2026-05-16T18:00:00.120Z","endedAt":"2026-05-16T18:00:01.000Z","durationMs":880,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_context_artifact","type":"artifact","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":6,"traceId":"trace_governance_retrieval","spanId":"span_context","artifactId":"artifact_context","kind":"context","createdAt":"2026-05-16T18:00:00.125Z","contentType":"text/plain","encoding":"text","sizeBytes":32,"preview":"Shared memory context","attributes":{"contextId":"memory","source":"context:memory"}}`,
		`{"schemaVersion":2,"recordId":"rec_context_consumed","type":"edge","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":7,"traceId":"trace_governance_retrieval","edgeId":"edge_context_consumed","edgeType":"consumed","from":{"kind":"artifact","id":"artifact_context"},"to":{"kind":"span","id":"span_generate"},"createdAt":"2026-05-16T18:00:00.126Z","attributes":{"source":"context:memory"}}`,
		`{"schemaVersion":2,"recordId":"rec_context_structured_artifact","type":"artifact","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":8,"traceId":"trace_governance_retrieval","spanId":"span_context","artifactId":"artifact_context_structured","kind":"context.contribution","createdAt":"2026-05-16T18:00:00.127Z","contentType":"application/json","encoding":"json","sizeBytes":140,"preview":{"kind":"context.contribution","state":"active","included":true,"sourceId":"context:memory","injectableKind":"context","tokens":4,"cacheStatus":"disabled"},"attributes":{"contextId":"memory","source":"context:memory","state":"active"}}`,
		`{"schemaVersion":2,"recordId":"rec_context_structured_consumed","type":"edge","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":9,"traceId":"trace_governance_retrieval","edgeId":"edge_context_structured_consumed","edgeType":"consumed","from":{"kind":"artifact","id":"artifact_context_structured"},"to":{"kind":"span","id":"span_generate"},"createdAt":"2026-05-16T18:00:00.128Z","attributes":{"source":"context:memory"}}`,
		`{"schemaVersion":2,"recordId":"rec_constraint_pass","type":"span","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":10,"traceId":"trace_governance_retrieval","spanId":"span_constraint_pass","parentSpanId":"span_generate","family":"constraint","primitive":"constraint.check","name":"format pass","startedAt":"2026-05-16T18:00:00.130Z","endedAt":"2026-05-16T18:00:00.140Z","durationMs":10,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_guardrail_block","type":"span","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":11,"traceId":"trace_governance_retrieval","spanId":"span_guardrail_block","parentSpanId":"span_generate","family":"guardrail","primitive":"guardrail.run","name":"pii block","startedAt":"2026-05-16T18:00:00.150Z","endedAt":"2026-05-16T18:00:00.160Z","durationMs":10,"status":"blocked"}`,
		`{"schemaVersion":2,"recordId":"rec_agent_end","type":"span:end","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":12,"traceId":"trace_governance_retrieval","spanId":"span_agent","endedAt":"2026-05-16T18:00:01.100Z","durationMs":1099,"status":"blocked"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_governance_retrieval","segmentId":"seg_governance_retrieval_a","segmentSeq":13,"traceId":"trace_governance_retrieval","endedAt":"2026-05-16T18:00:01.110Z","durationMs":1110,"status":"blocked"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_governance_retrieval")
	if err != nil {
		t.Fatal(err)
	}
	retrieval := findRunDetailNode(&detail.Root, "span_retrieval")
	if retrieval == nil {
		t.Fatalf("retrieval node missing")
	}
	if len(retrieval.Children) != 0 || len(retrieval.Details) != 1 || retrieval.Details[0].SpanID != "span_stage" {
		t.Fatalf("retrieval children/details = %#v / %#v, want folded stage", retrieval.Children, retrieval.Details)
	}
	generation := findRunDetailNode(&detail.Root, "span_generate")
	if generation == nil {
		t.Fatalf("generation node missing")
	}
	contextItems := generation.Inspection["context"]
	if len(contextItems) == 0 {
		t.Fatalf("generation context inspection = %#v, want consumed context artifact", generation.Inspection)
	}
	type contextInspectionData struct {
		Name       string `json:"name"`
		Primitive  string `json:"primitive"`
		Attributes struct {
			ContextID string `json:"contextId"`
			Source    string `json:"source"`
		} `json:"attributes"`
		Artifacts []struct {
			Kind    string          `json:"kind"`
			Preview json.RawMessage `json:"preview"`
		} `json:"artifacts"`
	}
	foundLegacyContext := false
	foundStructuredContext := false
	for _, item := range contextItems {
		var contextInspection contextInspectionData
		if err := json.Unmarshal(item.Data, &contextInspection); err != nil {
			t.Fatalf("decode generation context inspection: %v\n%s", err, item.Data)
		}
		if contextInspection.Name != "memory" || contextInspection.Primitive != "context.resolve" || contextInspection.Attributes.Source != "context:memory" {
			t.Fatalf("generation context inspection data = %#v, want enriched context detail", contextInspection)
		}
		for _, artifact := range contextInspection.Artifacts {
			switch artifact.Kind {
			case "context":
				var legacyPreview string
				if err := json.Unmarshal(artifact.Preview, &legacyPreview); err != nil || legacyPreview != "Shared memory context" {
					t.Fatalf("legacy context preview = %q err:%v", legacyPreview, err)
				}
				foundLegacyContext = true
			case "context.contribution":
				var structuredPreview struct {
					Kind     string `json:"kind"`
					State    string `json:"state"`
					SourceID string `json:"sourceId"`
				}
				if err := json.Unmarshal(artifact.Preview, &structuredPreview); err != nil {
					t.Fatalf("structured context preview should survive projection: %v", err)
				}
				if structuredPreview.Kind != "context.contribution" || structuredPreview.State != "active" || structuredPreview.SourceID != "context:memory" {
					t.Fatalf("structured context preview = %#v, want contribution payload", structuredPreview)
				}
				foundStructuredContext = true
			}
		}
	}
	if !foundLegacyContext || !foundStructuredContext {
		t.Fatalf("generation context inspection = %#v, want legacy and structured context artifacts", contextItems)
	}
	if findRunDetailNode(generation, "span_guardrail_block") == nil {
		t.Fatalf("blocked guardrail should be visible under generation: %#v", generation.Children)
	}
	if detail.SpanIndex["span_constraint_pass"].Placement != "detail" {
		t.Fatalf("constraint pass placement = %#v, want folded detail", detail.SpanIndex["span_constraint_pass"])
	}
}

func TestServiceRunDetailHonorsDisplayOverride(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_override","segmentId":"seg_override_a","segmentSeq":1,"traceId":"trace_override","name":"override","rootPrimitive":"custom.operation","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_primary_context","type":"span","runId":"run_override","segmentId":"seg_override_a","segmentSeq":2,"traceId":"trace_override","spanId":"span_primary_context","family":"context","primitive":"context.resolve","name":"important context","startedAt":"2026-05-16T18:00:00.001Z","endedAt":"2026-05-16T18:00:00.003Z","durationMs":2,"status":"ok","attributes":{"presentation":{"display":"primary"}}}`,
		`{"schemaVersion":2,"recordId":"rec_metadata_tool","type":"span","runId":"run_override","segmentId":"seg_override_a","segmentSeq":3,"traceId":"trace_override","spanId":"span_metadata_tool","family":"tool","primitive":"tool.call","name":"internal tool","startedAt":"2026-05-16T18:00:00.004Z","endedAt":"2026-05-16T18:00:00.010Z","durationMs":6,"status":"ok","attributes":{"presentation":{"display":"metadata"}}}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	detail, err := service.RunDetail(ctx, "run_override")
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Root.Children) != 1 || detail.Root.Children[0].SpanID != "span_primary_context" {
		t.Fatalf("primary children = %#v", detail.Root.Children)
	}
	if len(detail.Root.Details) != 1 || detail.Root.Details[0].SpanID != "span_metadata_tool" || detail.Root.Details[0].Display != "metadata" {
		t.Fatalf("run details = %#v", detail.Root.Details)
	}
	if detail.Counts.Primary != 1 || detail.Counts.Metadata != 1 {
		t.Fatalf("counts = %#v", detail.Counts)
	}
}

func TestServiceIngestsSingleRecordSpan(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_single_span","segmentId":"seg_single_span_a","segmentSeq":1,"traceId":"trace_single_span","name":"single span","rootPrimitive":"tool.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_single_span","type":"span","runId":"run_single_span","segmentId":"seg_single_span_a","segmentSeq":2,"traceId":"trace_single_span","spanId":"span_single","family":"tool","primitive":"tool.call","name":"tool call","startedAt":"2026-05-16T18:00:00.001Z","endedAt":"2026-05-16T18:00:00.011Z","durationMs":10,"status":"ok","toolName":"lookup_account","metrics":{"tokens":12},"attributes":{"attempt":1}}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	graph, err := service.Graph(ctx, "run_single_span")
	if err != nil {
		t.Fatal(err)
	}
	if len(graph.Spans) != 1 {
		t.Fatalf("span count = %d, want 1", len(graph.Spans))
	}
	if graph.Spans[0].Status != "ok" || graph.Spans[0].DurationMs != 10 {
		t.Fatalf("single span = %#v", graph.Spans[0])
	}
}

func TestServiceBuildsResourceActivityReadModel(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_resource","segmentId":"seg_resource_a","segmentSeq":1,"traceId":"trace_resource","name":"resource","rootPrimitive":"memory.write","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_memory","type":"span","runId":"run_resource","segmentId":"seg_resource_a","segmentSeq":2,"traceId":"trace_resource","spanId":"span_memory","family":"memory","primitive":"memory.write","name":"facts.propose","startedAt":"2026-05-16T18:00:00.001Z","endedAt":"2026-05-16T18:00:00.011Z","durationMs":10,"status":"ok","memoryId":"profile","attributes":{"memoryId":"profile","blockId":"facts","blockKind":"semantic","operation":"propose","writeMode":"propose","namespaceHash":"ns1"}}`,
		`{"schemaVersion":2,"recordId":"rec_memory_artifact","type":"artifact","runId":"run_resource","segmentId":"seg_resource_a","segmentSeq":3,"traceId":"trace_resource","spanId":"span_memory","artifactId":"artifact_memory","kind":"memory.snapshot","createdAt":"2026-05-16T18:00:00.010Z","contentType":"application/json","encoding":"json","preview":{"key":"answer","content":"42"},"attributes":{"memoryId":"profile","operation":"propose"}}`,
		`{"schemaVersion":2,"recordId":"rec_memory_edge","type":"edge","runId":"run_resource","segmentId":"seg_resource_a","segmentSeq":4,"traceId":"trace_resource","edgeId":"edge_memory","edgeType":"memory.write","from":{"kind":"span","id":"span_memory"},"to":{"kind":"artifact","id":"artifact_memory"},"createdAt":"2026-05-16T18:00:00.010Z","attributes":{"memoryId":"profile"}}`,
		`{"schemaVersion":2,"recordId":"rec_workspace","type":"span","runId":"run_resource","segmentId":"seg_resource_a","segmentSeq":5,"traceId":"trace_resource","spanId":"span_workspace","family":"workspace","primitive":"workspace.operation","name":"workspace.write","startedAt":"2026-05-16T18:00:00.012Z","endedAt":"2026-05-16T18:00:00.018Z","durationMs":6,"status":"ok","attributes":{"workspaceId":"drafts","operation":"write","path":"/output.md","namespaceHash":"ns2"}}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	memory, err := service.ResourceActivity(ctx, "memory")
	if err != nil {
		t.Fatal(err)
	}
	if len(memory) != 1 {
		t.Fatalf("memory activity = %d, want 1", len(memory))
	}
	if memory[0].Primitive != "memory.write" || memory[0].ResourceID != "profile" {
		t.Fatalf("memory activity = %#v", memory[0])
	}
	var attrs map[string]any
	if err := json.Unmarshal(memory[0].Attributes, &attrs); err != nil {
		t.Fatal(err)
	}
	if attrs["blockId"] != "facts" || attrs["operation"] != "propose" {
		t.Fatalf("attributes = %#v", attrs)
	}
	if len(memory[0].Artifacts) != 1 {
		t.Fatalf("memory artifacts = %d, want 1", len(memory[0].Artifacts))
	}
	var preview map[string]any
	if err := json.Unmarshal(memory[0].Artifacts[0].Preview, &preview); err != nil {
		t.Fatal(err)
	}
	if preview["key"] != "answer" {
		t.Fatalf("artifact preview = %#v", preview)
	}
	if len(memory[0].Edges) != 1 || memory[0].Edges[0].EdgeType != "memory.write" {
		t.Fatalf("memory edges = %#v", memory[0].Edges)
	}

	workspace, err := service.ResourceActivity(ctx, "workspace")
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace) != 1 || workspace[0].ResourceID != "drafts" {
		t.Fatalf("workspace activity = %#v", workspace)
	}
}

func TestServiceBuildsDeferResourceActivityReadModel(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_defer_run_start","type":"run:start","runId":"run_defer","segmentId":"seg_defer_a","segmentSeq":1,"traceId":"trace_defer","name":"deferred work","rootPrimitive":"defer.scheduled","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_defer_scheduled","type":"span","runId":"run_defer","segmentId":"seg_defer_a","segmentSeq":2,"traceId":"trace_defer","spanId":"span_defer_scheduled","family":"defer","primitive":"defer.scheduled","name":"defer named send-email","startedAt":"2026-05-16T18:00:00.001Z","endedAt":"2026-05-16T18:00:00.002Z","durationMs":1,"status":"ok","attributes":{"mode":"named","completion":"handler-returned","sequence":0,"workId":"work_abc","targetId":"task:send-email","intentState":"released","definitionId":"deferred-work:named:app.ts:deadbeef:1"}}`,
		`{"schemaVersion":2,"recordId":"rec_defer_run","type":"span","runId":"run_defer","segmentId":"seg_defer_a","segmentSeq":3,"traceId":"trace_defer","spanId":"span_defer_run","family":"defer","primitive":"defer.run","name":"defer run #0","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.020Z","durationMs":10,"status":"ok","attributes":{"mode":"named","completion":"handler-returned","sequence":0,"workId":"work_abc","outcome":"completed"}}`,
		`{"schemaVersion":2,"recordId":"rec_defer_edge","type":"edge","runId":"run_defer","segmentId":"seg_defer_a","segmentSeq":4,"traceId":"trace_defer","edgeId":"edge_defer","edgeType":"triggered","from":{"kind":"span","id":"span_defer_scheduled"},"to":{"kind":"span","id":"span_defer_run"},"createdAt":"2026-05-16T18:00:00.010Z"}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	activity, err := service.ResourceActivity(ctx, "defer")
	if err != nil {
		t.Fatal(err)
	}
	if len(activity) != 2 {
		t.Fatalf("defer activity = %d, want 2", len(activity))
	}
	if activity[0].ResourceID != "work_abc" && activity[1].ResourceID != "work_abc" {
		t.Fatalf("expected work_abc resource id, got %#v %#v", activity[0].ResourceID, activity[1].ResourceID)
	}
	byPrimitive := map[string]ResourceActivity{}
	for _, item := range activity {
		byPrimitive[item.Primitive] = item
	}
	if byPrimitive["defer.scheduled"].ResourceID != "work_abc" {
		t.Fatalf("scheduled activity = %#v", byPrimitive["defer.scheduled"])
	}
	if byPrimitive["defer.run"].ResourceID != "work_abc" {
		t.Fatalf("run activity = %#v", byPrimitive["defer.run"])
	}
}

func TestServiceResourceActivityLimitsLatestWithAttachments(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	started := time.Date(2026, 5, 16, 18, 0, 0, 0, time.UTC)
	records := []string{
		`{"schemaVersion":2,"recordId":"rec_activity_limit_run","type":"run:start","runId":"run_activity_limit","segmentId":"seg_activity_limit_a","segmentSeq":1,"traceId":"trace_activity_limit","name":"activity limit","rootPrimitive":"memory.write","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
	}
	for i := 0; i < 501; i++ {
		spanID := fmt.Sprintf("span_activity_%03d", i)
		artifactID := fmt.Sprintf("artifact_activity_%03d", i)
		timestamp := started.Add(time.Duration(i) * time.Millisecond).Format("2006-01-02T15:04:05.000Z")
		records = append(records,
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"rec_activity_span_%03d","type":"span","runId":"run_activity_limit","segmentId":"seg_activity_limit_a","segmentSeq":%d,"traceId":"trace_activity_limit","spanId":%q,"family":"memory","primitive":"memory.write","name":"activity","startedAt":%q,"endedAt":%q,"durationMs":1,"status":"ok","memoryId":"profile-%03d","attributes":{"memoryId":"profile-%03d"}}`, i, 2+i*3, spanID, timestamp, timestamp, i, i),
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"rec_activity_artifact_%03d","type":"artifact","runId":"run_activity_limit","segmentId":"seg_activity_limit_a","segmentSeq":%d,"traceId":"trace_activity_limit","spanId":%q,"artifactId":%q,"kind":"memory.snapshot","createdAt":%q,"contentType":"application/json","encoding":"json","preview":{"index":%d}}`, i, 3+i*3, spanID, artifactID, timestamp, i),
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"rec_activity_edge_%03d","type":"edge","runId":"run_activity_limit","segmentId":"seg_activity_limit_a","segmentSeq":%d,"traceId":"trace_activity_limit","edgeId":"edge_activity_%03d","edgeType":"memory.write","from":{"kind":"span","id":%q},"to":{"kind":"artifact","id":%q},"createdAt":%q}`, i, 4+i*3, i, spanID, artifactID, timestamp),
		)
	}
	const ingestBatchSize = 250
	for start := 0; start < len(records); start += ingestBatchSize {
		end := min(start+ingestBatchSize, len(records))
		if err := service.Ingest(ctx, mustBatch(t, records[start:end]...)); err != nil {
			t.Fatal(err)
		}
	}

	activity, err := service.ResourceActivity(ctx, "memory")
	if err != nil {
		t.Fatal(err)
	}
	if len(activity) != 500 {
		t.Fatalf("activity count = %d, want latest 500", len(activity))
	}
	if activity[0].SpanID != "span_activity_500" {
		t.Fatalf("first activity span = %q, want latest span_activity_500", activity[0].SpanID)
	}
	for _, item := range activity {
		if item.SpanID == "span_activity_000" {
			t.Fatalf("activity includes oldest span outside latest limit: %#v", item)
		}
		if len(item.Artifacts) != 1 || len(item.Edges) != 1 {
			t.Fatalf("activity %q attachments = artifacts:%d edges:%d, want 1/1", item.SpanID, len(item.Artifacts), len(item.Edges))
		}
	}
}

func TestServiceMergesSpanStartAndEndAttributesForResourceActivity(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_memory_merge","segmentId":"seg_memory_merge_a","segmentSeq":1,"traceId":"trace_memory_merge","name":"resource","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_memory_start","type":"span:start","runId":"run_memory_merge","segmentId":"seg_memory_merge_a","segmentSeq":2,"traceId":"trace_memory_merge","spanId":"span_memory","family":"memory","primitive":"memory.read","name":"facts.find","startedAt":"2026-05-16T18:00:00.001Z","status":"running","attributes":{"memoryId":"profile","memoryType":"block","blockId":"facts","blockKind":"facts","operation":"find","namespaceHash":"ns1"}}`,
		`{"schemaVersion":2,"recordId":"rec_memory_end","type":"span:end","runId":"run_memory_merge","segmentId":"seg_memory_merge_a","segmentSeq":3,"traceId":"trace_memory_merge","spanId":"span_memory","endedAt":"2026-05-16T18:00:00.011Z","durationMs":10,"status":"ok","attributes":{"resultCount":2,"query":"brand voice"}}`,
		`{"schemaVersion":2,"recordId":"rec_memory_reverse_end","type":"span:end","runId":"run_memory_merge","segmentId":"seg_memory_merge_a","segmentSeq":4,"traceId":"trace_memory_merge","spanId":"span_memory_reverse","endedAt":"2026-05-16T18:00:00.020Z","durationMs":5,"status":"ok","attributes":{"resultCount":1,"query":"launch"}}`,
		`{"schemaVersion":2,"recordId":"rec_memory_reverse_start","type":"span:start","runId":"run_memory_merge","segmentId":"seg_memory_merge_a","segmentSeq":5,"traceId":"trace_memory_merge","spanId":"span_memory_reverse","family":"memory","primitive":"memory.read","name":"episodes.list","startedAt":"2026-05-16T18:00:00.015Z","status":"running","attributes":{"memoryId":"episodes","memoryType":"block","blockId":"episodes","blockKind":"episodes","operation":"list","namespaceHash":"ns2"}}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	memory, err := service.ResourceActivity(ctx, "memory")
	if err != nil {
		t.Fatal(err)
	}
	bySpan := map[string]ResourceActivity{}
	for _, activity := range memory {
		bySpan[activity.SpanID] = activity
	}

	facts := bySpan["span_memory"]
	if facts.ResourceID != "profile" {
		t.Fatalf("facts resource id = %q, want profile; activity = %#v", facts.ResourceID, facts)
	}
	var factsAttrs map[string]any
	if err := json.Unmarshal(facts.Attributes, &factsAttrs); err != nil {
		t.Fatal(err)
	}
	if factsAttrs["memoryId"] != "profile" || factsAttrs["blockId"] != "facts" || factsAttrs["query"] != "brand voice" || factsAttrs["resultCount"] != float64(2) {
		t.Fatalf("facts attrs = %#v", factsAttrs)
	}

	episodes := bySpan["span_memory_reverse"]
	if episodes.ResourceID != "episodes" {
		t.Fatalf("episodes resource id = %q, want episodes; activity = %#v", episodes.ResourceID, episodes)
	}
	var episodeAttrs map[string]any
	if err := json.Unmarshal(episodes.Attributes, &episodeAttrs); err != nil {
		t.Fatal(err)
	}
	if episodeAttrs["memoryId"] != "episodes" || episodeAttrs["blockId"] != "episodes" || episodeAttrs["query"] != "launch" || episodeAttrs["resultCount"] != float64(1) {
		t.Fatalf("episode attrs = %#v", episodeAttrs)
	}
}

func TestServiceIngestIsIdempotent(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := loadGenerationFixture(t)
	runID := generationFixtureRunID(t, batch)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	run, err := service.Run(ctx, runID)
	if err != nil {
		t.Fatal(err)
	}
	if run.RecordCount != len(batch.Records) {
		t.Fatalf("record count = %d, want %d", run.RecordCount, len(batch.Records))
	}
	if run.SpanCount != 1 || run.ArtifactCount != 4 || run.EdgeCount != 4 {
		t.Fatalf("counts after duplicate ingest = %#v", run)
	}
}

func TestServicePublishesIngestEvents(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service := newTestService(t)
	events := service.Events().Subscribe(ctx)
	batch := loadGenerationFixture(t)
	runID := generationFixtureRunID(t, batch)
	traceID := generationFixtureTraceID(t, batch)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	select {
	case event := <-events:
		if event.Kind != "observability.records" || event.Action != "ingested" {
			t.Fatalf("event = %#v", event)
		}
		if event.RefID != runID {
			t.Fatalf("event ref = %q", event.RefID)
		}
		var payload map[string]any
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if payload["operationId"] != runID || payload["traceId"] != traceID || payload["entity"] != "operation" {
			t.Fatalf("payload = %#v", payload)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for observability ingest event")
	}
}

func TestServicePublishesLifecycleReconciliationEvents(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service := newTestService(t)
	events := service.Events().Subscribe(ctx)
	started := time.Now().Add(-2 * time.Minute).UTC()
	generationStarted := started.Add(4 * time.Second).UTC()
	deadline := generationStarted.Add(60 * time.Second).UTC()
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_lifecycle","segmentId":"seg_lifecycle_a","segmentSeq":1,"traceId":"trace_lifecycle","name":"chat","rootPrimitive":"agent.run","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_lifecycle","segmentId":"seg_lifecycle_a","segmentSeq":2,"traceId":"trace_lifecycle","spanId":"span_chat","family":"agent","primitive":"agent.run","name":"chat","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_gen","type":"span:start","runId":"run_lifecycle","segmentId":"seg_lifecycle_a","segmentSeq":3,"traceId":"trace_lifecycle","spanId":"span_generate","parentSpanId":"span_chat","family":"generation","primitive":"generation.call","name":"generate","startedAt":"`+generationStarted.Format(time.RFC3339Nano)+`","status":"running","attributes":{"timeoutMs":60000}}`,
		`{"schemaVersion":2,"recordId":"rec_deadline","type":"span:event","runId":"run_lifecycle","segmentId":"seg_lifecycle_a","segmentSeq":4,"traceId":"trace_lifecycle","spanId":"span_generate","eventId":"event_deadline","name":"operation.deadline","timestamp":"`+generationStarted.Format(time.RFC3339Nano)+`","attributes":{"timeoutMs":60000,"deadlineAt":"`+deadline.Format(time.RFC3339Nano)+`"}}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}
	drainEvents(events)

	if err := service.PublishLifecycleReconciliations(ctx); err != nil {
		t.Fatal(err)
	}

	select {
	case event := <-events:
		if event.Kind != "observability.lifecycle" || event.Action != "reconciled" || event.RefID != "run_lifecycle" {
			t.Fatalf("event = %#v", event)
		}
		var payload map[string]any
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if payload["status"] != "incomplete" || payload["reason"] != "descendant-operation-deadline-exceeded" {
			t.Fatalf("payload = %#v", payload)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for lifecycle reconciliation event")
	}

	if err := service.PublishLifecycleReconciliations(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-events:
		t.Fatalf("duplicate lifecycle event = %#v", event)
	default:
	}
}

func TestServiceLifecycleIgnoresCompletedRunWithStaleDescendant(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service := newTestService(t)
	events := service.Events().Subscribe(ctx)
	runStarted := time.Now().Add(-2 * time.Minute).UTC()
	runEnded := runStarted.Add(time.Second).UTC()
	childStarted := runStarted.Add(10 * time.Second).UTC()
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_completed_with_open_child","segmentId":"seg_completed_with_open_child_a","segmentSeq":1,"traceId":"trace_completed_with_open_child","name":"scheduled parent","rootPrimitive":"runtime.convex.action","startedAt":"`+runStarted.Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_run_end","type":"run:end","runId":"run_completed_with_open_child","segmentId":"seg_completed_with_open_child_a","segmentSeq":2,"traceId":"trace_completed_with_open_child","endedAt":"`+runEnded.Format(time.RFC3339Nano)+`","durationMs":1000,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_child_start","type":"span:start","runId":"run_completed_with_open_child","segmentId":"seg_completed_with_open_child_a","segmentSeq":3,"traceId":"trace_completed_with_open_child","spanId":"span_child","family":"agent","primitive":"agent.run","name":"Support Agent streamText","startedAt":"`+childStarted.Format(time.RFC3339Nano)+`","status":"running"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}
	drainEvents(events)

	if err := service.PublishLifecycleReconciliations(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-events:
		t.Fatalf("completed run produced lifecycle event = %#v", event)
	default:
	}
}

func TestServicePublishesCoalescedTokenChunkEvents(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service := newTestService(t)
	events := service.Events().Subscribe(ctx)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_tokens","segmentId":"seg_tokens_a","segmentSeq":1,"traceId":"trace_tokens","name":"tokens","rootPrimitive":"generation.stream","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span:start","runId":"run_tokens","segmentId":"seg_tokens_a","segmentSeq":2,"traceId":"trace_tokens","spanId":"span_generate","family":"generation","primitive":"generation.stream","name":"stream","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_token_1","type":"span:event","runId":"run_tokens","segmentId":"seg_tokens_a","segmentSeq":3,"traceId":"trace_tokens","spanId":"span_generate","eventId":"event_token_1","name":"token.chunk","timestamp":"2026-05-16T18:00:00.100Z","attributes":{"chunkIndex":0,"charCount":3,"text":"Hi👍","firstDeltaAt":"2026-05-16T18:00:00.090Z","lastDeltaAt":"2026-05-16T18:00:00.100Z"}}`,
		`{"schemaVersion":2,"recordId":"rec_token_2","type":"span:event","runId":"run_tokens","segmentId":"seg_tokens_a","segmentSeq":4,"traceId":"trace_tokens","spanId":"span_generate","eventId":"event_token_2","name":"token.chunk","timestamp":"2026-05-16T18:00:00.200Z","attributes":{"chunkIndex":1,"charCount":1,"text":"!","firstDeltaAt":"2026-05-16T18:00:00.190Z","lastDeltaAt":"2026-05-16T18:00:00.200Z"}}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	var tokenEvent Event
	for i := 0; i < 2; i++ {
		select {
		case event := <-events:
			if event.Kind == "token.chunk" {
				tokenEvent = event
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for token chunk event")
		}
	}
	if tokenEvent.Kind != "token.chunk" || tokenEvent.Action != "appended" || tokenEvent.RefID != "run_tokens" {
		t.Fatalf("token event = %#v", tokenEvent)
	}
	var payload map[string]any
	if err := json.Unmarshal(tokenEvent.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	attrs, ok := payload["attributes"].(map[string]any)
	if !ok || attrs["text"] != "Hi👍!" || attrs["charCount"] != float64(4) {
		t.Fatalf("token payload = %#v", payload)
	}
	select {
	case event := <-events:
		if event.Kind == "token.chunk" {
			t.Fatalf("received uncoalesced token event: %#v", event)
		}
	default:
	}
}

func TestServiceCapsTokenChunkEventsPerSpan(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	records := []string{
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_token_ring","segmentId":"seg_token_ring_a","segmentSeq":1,"traceId":"trace_token_ring","name":"tokens","rootPrimitive":"generation.stream","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_generate","type":"span:start","runId":"run_token_ring","segmentId":"seg_token_ring_a","segmentSeq":2,"traceId":"trace_token_ring","spanId":"span_generate","family":"generation","primitive":"generation.stream","name":"stream","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`,
	}
	for i := 0; i < 600; i++ {
		records = append(records, fmt.Sprintf(
			`{"schemaVersion":2,"recordId":"rec_token_%03d","type":"span:event","runId":"run_token_ring","segmentId":"seg_token_ring_a","segmentSeq":%d,"traceId":"trace_token_ring","spanId":"span_generate","eventId":"event_token_%03d","name":"token.chunk","timestamp":"2026-05-16T18:00:%02d.%03dZ","attributes":{"chunkIndex":%d,"charCount":1,"text":"x","firstDeltaAt":"2026-05-16T18:00:%02d.%03dZ","lastDeltaAt":"2026-05-16T18:00:%02d.%03dZ"}}`,
			i,
			i+3,
			i,
			i/1000,
			i%1000,
			i,
			i/1000,
			i%1000,
			i/1000,
			i%1000,
		))
	}

	if err := service.Ingest(ctx, mustBatch(t, records...)); err != nil {
		t.Fatal(err)
	}

	events, err := service.SpanEvents(ctx, "run_token_ring", "span_generate", SpanEventListOptions{
		Name:  "token.chunk",
		Limit: 600,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 512 {
		t.Fatalf("event count = %d, want 512", len(events))
	}
	if events[0].EventID != "event_token_088" || events[len(events)-1].EventID != "event_token_599" {
		t.Fatalf("event range = %s..%s, want newest capped ring", events[0].EventID, events[len(events)-1].EventID)
	}
}

func drainEvents(events <-chan Event) {
	for {
		select {
		case <-events:
		default:
			return
		}
	}
}

func TestServiceReconcilesOutOfOrderLifecycleRecords(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	fixture := loadGenerationFixture(t)
	runID := generationFixtureRunID(t, fixture)
	reordered := Batch{Records: []Record{
		fixtureRecordByID(t, fixture, "rec_164c0d7c7e272dd7_d"), // run:end before run:start
		fixtureRecordByID(t, fixture, "rec_30087e99fc7dcf3b_c"), // span:end before span:start
		fixtureRecordByID(t, fixture, "rec_c89e3f639b60b2b2_2"),
		fixtureRecordByID(t, fixture, "rec_b7862451676111a8_1"),
	}}

	if err := service.Ingest(ctx, reordered); err != nil {
		t.Fatal(err)
	}

	run, err := service.Run(ctx, runID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "ok" || run.Name != "support reply" {
		t.Fatalf("run = %#v", run)
	}

	graph, err := service.Graph(ctx, runID)
	if err != nil {
		t.Fatal(err)
	}
	if got := graph.Spans[0].Status; got != "ok" {
		t.Fatalf("span status = %q, want ok", got)
	}
	if graph.Spans[0].StartedAt == "" || graph.Spans[0].EndedAt == "" {
		t.Fatalf("span lifecycle timestamps not reconciled: %#v", graph.Spans[0])
	}
}

func TestServiceReconcilesEveryAffectedRunAndSegmentInOneBatch(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)

	var records []string
	for _, run := range []struct{ runID, traceID, segmentA, segmentB string }{
		{"run_batch_reconcile_1", "trace_batch_reconcile_1", "seg_batch_reconcile_1_a", "seg_batch_reconcile_1_b"},
		{"run_batch_reconcile_2", "trace_batch_reconcile_2", "seg_batch_reconcile_2_a", "seg_batch_reconcile_2_b"},
		{"run_batch_reconcile_3", "trace_batch_reconcile_3", "seg_batch_reconcile_3_a", "seg_batch_reconcile_3_b"},
	} {
		records = append(records,
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"rec_%[1]s_start","type":"run:start","runId":%[1]q,"traceId":%[2]q,"segmentId":%[3]q,"segmentSeq":1,"name":"batch reconcile","rootPrimitive":"flow.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`, run.runID, run.traceID, run.segmentA),
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"rec_%[1]s_suspend","type":"run:suspend","runId":%[1]q,"traceId":%[2]q,"segmentId":%[3]q,"segmentSeq":2,"suspendedAt":"2026-05-16T18:00:01.000Z","reason":"gate"}`, run.runID, run.traceID, run.segmentA),
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"rec_%[1]s_resume","type":"run:resume","runId":%[1]q,"traceId":%[2]q,"segmentId":%[4]q,"segmentSeq":1,"resumedAt":"2026-05-16T18:00:02.000Z","reason":"gate","previousSegmentId":%[3]q}`, run.runID, run.traceID, run.segmentA, run.segmentB),
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"rec_%[1]s_end","type":"run:end","runId":%[1]q,"traceId":%[2]q,"segmentId":%[3]q,"segmentSeq":2,"endedAt":"2026-05-16T18:00:03.000Z","status":"ok"}`, run.runID, run.traceID, run.segmentB),
		)
	}
	// A fourth run in the same batch has a genuine gap (missing previous
	// segment), which must still be detected once per-run/segment
	// reconciliation runs at the end of the transaction.
	records = append(records,
		`{"schemaVersion":2,"recordId":"rec_batch_reconcile_gap_resume","type":"run:resume","runId":"run_batch_reconcile_gap","traceId":"trace_batch_reconcile_gap","segmentId":"seg_batch_reconcile_gap_b","segmentSeq":1,"resumedAt":"2026-05-16T18:00:00.000Z","reason":"replay","previousSegmentId":"seg_batch_reconcile_gap_a"}`,
	)

	if err := service.Ingest(ctx, mustBatch(t, records...)); err != nil {
		t.Fatal(err)
	}

	for _, runID := range []string{"run_batch_reconcile_1", "run_batch_reconcile_2", "run_batch_reconcile_3"} {
		run, err := service.Run(ctx, runID)
		if err != nil {
			t.Fatal(err)
		}
		if run.Status != "ok" || run.SegmentCount != 2 {
			t.Fatalf("run %q projection = %#v, want status ok across 2 segments", runID, run)
		}
	}

	gapRun, err := service.Run(ctx, "run_batch_reconcile_gap")
	if err != nil {
		t.Fatal(err)
	}
	if gapRun.GapCount != 1 || gapRun.OrderingConfidence != "partial" {
		t.Fatalf("gap run projection = %#v, want one gap and partial ordering", gapRun)
	}
}

func TestServiceRejectsInvalidBatchTransactionally(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	fixture := loadGenerationFixture(t)
	runID := generationFixtureRunID(t, fixture)
	batch := Batch{Records: []Record{fixture.Records[0], fixture.Records[1]}}
	batch.Records[1].Payload = []byte(`{
		"schemaVersion": 1,
		"recordId": "rec_invalid_family",
		"type": "span:start",
		"runId": "run_generation_fixture_01",
		"spanId": "span_invalid_family",
		"family": "tool",
		"primitive": "generation.call",
		"name": "invalid",
		"startedAt": "2026-05-16T18:00:00.000Z",
		"status": "running"
	}`)

	if err := service.Ingest(ctx, batch); err == nil {
		t.Fatal("expected invalid batch to fail")
	}
	if _, err := service.Run(ctx, runID); !errors.Is(err, ErrNotFound) {
		t.Fatal("expected transactional rollback to leave no run")
	}
}

func TestServiceErrorsPreserveCauseWithContext(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)

	_, err := service.Run(ctx, "missing_run")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("Run error = %v, want ErrNotFound cause", err)
	}
	if err == ErrNotFound {
		t.Fatal("Run should annotate ErrNotFound with the missing run id")
	}

	batch := mustBatch(t, `{"schemaVersion":2,"recordId":"rec_bad","type":"span","runId":"run_bad","segmentId":"seg_bad_a","segmentSeq":1,"spanId":"span_bad","family":"tool","primitive":"generation.call","name":"bad","startedAt":"2026-05-16T18:00:00.001Z","status":"ok"}`)
	err = service.Ingest(ctx, batch)
	if err == nil {
		t.Fatal("expected invalid span to fail")
	}
	if want := `validate observability record "rec_bad"`; !strings.Contains(err.Error(), want) {
		t.Fatalf("error = %q, want context %q", err.Error(), want)
	}
}

func TestOpenServicePersistsSQLiteDatabase(t *testing.T) {
	t.Setenv("CRUX_OBSERVABILITY_RETENTION_DAYS", "36500")
	ctx := context.Background()
	path := t.TempDir() + "/observability.sqlite"

	service, err := OpenService(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	batch := loadGenerationFixture(t)
	runID := generationFixtureRunID(t, batch)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenService(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := reopened.Close(); err != nil {
			t.Fatal(err)
		}
	})

	run, err := reopened.Run(ctx, runID)
	if err != nil {
		t.Fatal(err)
	}
	if run.RecordCount != 13 || run.SpanCount != 1 || run.ArtifactCount != 4 || run.EdgeCount != 4 {
		t.Fatalf("persisted run = %#v", run)
	}
}

func TestOpenServiceConfiguresFileSQLiteForConcurrentAccess(t *testing.T) {
	ctx := context.Background()
	path := t.TempDir() + "/observability.sqlite"

	service, err := OpenService(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := service.Close(); err != nil {
			t.Fatal(err)
		}
	})

	if got, want := service.db.Stats().MaxOpenConnections, fileDatabaseMaxOpenConns; got != want {
		t.Fatalf("max open connections = %d, want %d", got, want)
	}
	var busyTimeout int
	if err := service.db.QueryRowContext(ctx, `PRAGMA busy_timeout`).Scan(&busyTimeout); err != nil {
		t.Fatal(err)
	}
	if busyTimeout != 5000 {
		t.Fatalf("busy_timeout = %d, want 5000", busyTimeout)
	}
	var journalMode string
	if err := service.db.QueryRowContext(ctx, `PRAGMA journal_mode`).Scan(&journalMode); err != nil {
		t.Fatal(err)
	}
	if strings.ToLower(journalMode) != "wal" {
		t.Fatalf("journal_mode = %q, want wal", journalMode)
	}

	conn1, err := service.db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn1.Close()
	conn2, err := service.db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn2.Close()
	for index, conn := range []*sql.Conn{conn1, conn2} {
		var connBusyTimeout int
		if err := conn.QueryRowContext(ctx, `PRAGMA busy_timeout`).Scan(&connBusyTimeout); err != nil {
			t.Fatal(err)
		}
		if connBusyTimeout != 5000 {
			t.Fatalf("connection %d busy_timeout = %d, want 5000", index+1, connBusyTimeout)
		}
	}
}

func TestOpenServiceAllowsConcurrentFileReadsDuringIngest(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	path := t.TempDir() + "/observability.sqlite"

	service, err := OpenService(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := service.Close(); err != nil {
			t.Fatal(err)
		}
	})

	var wg sync.WaitGroup
	errs := make(chan error, 32)
	batches := make([]Batch, 8)
	runIDs := make([]string, 8)
	for i := 0; i < 8; i++ {
		runID := fmt.Sprintf("run_concurrent_%02d", i)
		segmentID := fmt.Sprintf("seg_concurrent_%02d_a", i)
		traceID := fmt.Sprintf("trace_concurrent_%02d", i)
		spanID := fmt.Sprintf("span_concurrent_%02d", i)
		runIDs[i] = runID
		batches[i] = mustBatch(t,
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"%s-start","type":"run:start","runId":%q,"segmentId":%q,"segmentSeq":1,"traceId":%q,"name":"concurrent","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`, runID, runID, segmentID, traceID),
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"%s-span","type":"span","runId":%q,"segmentId":%q,"segmentSeq":2,"traceId":%q,"spanId":%q,"family":"generation","primitive":"generation.stream","name":"stream","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.020Z","durationMs":10,"status":"ok"}`, runID, runID, segmentID, traceID, spanID),
			fmt.Sprintf(`{"schemaVersion":2,"recordId":"%s-end","type":"run:end","runId":%q,"segmentId":%q,"segmentSeq":3,"traceId":%q,"endedAt":"2026-05-16T18:00:00.030Z","durationMs":30,"status":"ok"}`, runID, runID, segmentID, traceID),
		)
	}
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			if err := service.Ingest(ctx, batches[index]); err != nil {
				errs <- fmt.Errorf("ingest %s: %w", runIDs[index], err)
			}
		}(i)
	}
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := service.RunsWithOptions(ctx, RunListOptions{Limit: 5}); err != nil {
				errs <- fmt.Errorf("list runs during ingest: %w", err)
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func TestNewServiceKeepsInMemorySQLiteOnSingleConnection(t *testing.T) {
	service := newTestService(t)

	if got, want := service.db.Stats().MaxOpenConnections, inMemoryMaxOpenConns; got != want {
		t.Fatalf("max open connections = %d, want %d", got, want)
	}
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
	})

	service, err := NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func loadGenerationFixture(t *testing.T) Batch {
	t.Helper()
	raw := readCoreObservabilityFixture(t, "generation-run.json")

	var batch Batch
	if err := json.Unmarshal(raw, &batch); err != nil {
		t.Fatal(err)
	}
	return batch
}

func generationFixtureRunID(t *testing.T, batch Batch) string {
	t.Helper()
	if len(batch.Records) == 0 || batch.Records[0].RunID == "" {
		t.Fatal("generation fixture is missing its run id")
	}
	return batch.Records[0].RunID
}

func generationFixtureTraceID(t *testing.T, batch Batch) string {
	t.Helper()
	if len(batch.Records) == 0 || batch.Records[0].TraceID == "" {
		t.Fatal("generation fixture is missing its trace id")
	}
	return batch.Records[0].TraceID
}

func fixtureRecordByID(t *testing.T, batch Batch, recordID string) Record {
	t.Helper()
	for _, record := range batch.Records {
		if record.RecordID == recordID {
			return record
		}
	}
	t.Fatalf("fixture record %q not found", recordID)
	return Record{}
}

func loadGoldenNodeFixture(t *testing.T) Batch {
	t.Helper()
	raw := readCoreObservabilityFixture(t, "golden-node-run.json")

	var batch Batch
	if err := json.Unmarshal(raw, &batch); err != nil {
		t.Fatal(err)
	}
	return batch
}

func mustBatch(t *testing.T, records ...string) Batch {
	t.Helper()
	batch := Batch{Records: make([]Record, 0, len(records))}
	for _, raw := range records {
		var fields map[string]any
		if err := json.Unmarshal([]byte(raw), &fields); err != nil {
			t.Fatal(err)
		}
		fields["schemaVersion"] = SchemaVersion
		if _, ok := fields["operationId"]; !ok {
			fields["operationId"] = fields["runId"]
		}
		upgraded, err := json.Marshal(fields)
		if err != nil {
			t.Fatal(err)
		}
		var record Record
		if err := json.Unmarshal(upgraded, &record); err != nil {
			t.Fatal(err)
		}
		batch.Records = append(batch.Records, record)
	}
	return batch
}

func containsTestString(values []string, value string) bool {
	for _, existing := range values {
		if existing == value {
			return true
		}
	}
	return false
}
