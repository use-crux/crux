package devtools

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestDirectClientQualityRunsGetJSONUsesRegisteredFilters(t *testing.T) {
	ctx := context.Background()
	obs, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer obs.Close()

	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{"records":[
		{"schemaVersion":1,"recordId":"run-gen-start","type":"run:start","runId":"run_filter_generation","traceId":"trace_filter_generation","name":"support reply","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"span-gen","type":"span","runId":"run_filter_generation","traceId":"trace_filter_generation","spanId":"span_filter_generation","family":"generation","primitive":"generation.call","name":"support reply","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.100Z","durationMs":90,"status":"ok","model":"gpt-4o","provider":"openai"},
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

	s := store.NewStore()
	qualitySvc := quality.NewService(s, quality.Dir(t.TempDir())).WithObservability(obs)
	client := NewDirectClientFromService(NewService(s, qualitySvc))

	var runs []api.QualityRunRecord
	if err := client.GetJSON(ctx, "/api/quality/runs?kind=generation&model=gpt-4o", &runs); err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].TraceID != "run_filter_generation" {
		t.Fatalf("runs = %#v, want filtered generation run", runs)
	}
}
