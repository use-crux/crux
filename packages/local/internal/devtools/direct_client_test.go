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
		{"schemaVersion":2,"recordId":"run-gen-start","type":"run:start","runId":"run_filter_generation","segmentId":"seg_filter_generation","segmentSeq":1,"traceId":"trace_filter_generation","name":"support reply","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":2,"recordId":"span-gen","type":"span","runId":"run_filter_generation","segmentId":"seg_filter_generation","segmentSeq":2,"traceId":"trace_filter_generation","spanId":"span_filter_generation","family":"generation","primitive":"generation.call","name":"support reply","startedAt":"2026-05-16T18:00:00.010Z","endedAt":"2026-05-16T18:00:00.100Z","durationMs":90,"status":"ok","model":"gpt-4o","provider":"openai"},
		{"schemaVersion":2,"recordId":"run-gen-end","type":"run:end","runId":"run_filter_generation","segmentId":"seg_filter_generation","segmentSeq":3,"traceId":"trace_filter_generation","endedAt":"2026-05-16T18:00:00.120Z","durationMs":120,"status":"ok"},
		{"schemaVersion":2,"recordId":"run-ret-start","type":"run:start","runId":"run_filter_retrieval","segmentId":"seg_filter_retrieval","segmentSeq":1,"traceId":"trace_filter_retrieval","name":"search docs","rootPrimitive":"retrieval.query","startedAt":"2026-05-16T18:01:00.000Z","status":"running"},
		{"schemaVersion":2,"recordId":"span-ret","type":"span","runId":"run_filter_retrieval","segmentId":"seg_filter_retrieval","segmentSeq":2,"traceId":"trace_filter_retrieval","spanId":"span_filter_retrieval","family":"retrieval","primitive":"retrieval.query","name":"search docs","startedAt":"2026-05-16T18:01:00.010Z","endedAt":"2026-05-16T18:01:00.100Z","durationMs":90,"status":"ok","model":"claude-3-5-sonnet","provider":"anthropic"},
		{"schemaVersion":2,"recordId":"run-ret-end","type":"run:end","runId":"run_filter_retrieval","segmentId":"seg_filter_retrieval","segmentSeq":3,"traceId":"trace_filter_retrieval","endedAt":"2026-05-16T18:01:00.120Z","durationMs":120,"status":"ok"}
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

func TestDirectClientProjectIndexIncludesStorageReadModel(t *testing.T) {
	ctx := context.Background()
	s := store.NewStore()
	s.SetIndexData(store.IndexData{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "storage.recordStore:records",
				Kind:     "storage.recordStore",
				Name:     "records",
				Fidelity: "resolved",
				Status:   "active",
				Metadata: json.RawMessage(`{"facts":{"kind":"storage.recordStore","backend":"inMemoryRecordStore","capabilities":{"record":{"ttl":"lazy","filter":"scan","watch":true,"batch":false}}}}`),
			},
			{
				ID:       "storage.bundle:appStorage",
				Kind:     "storage.bundle",
				Name:     "appStorage",
				Fidelity: "resolved",
				Status:   "active",
				Metadata: json.RawMessage(`{"facts":{"kind":"storage.bundle","records":"records"}}`),
			},
			{ID: "workspace:docs", Kind: "workspace", Name: "docs", Fidelity: "resolved", Status: "active"},
		},
		Relations: []store.ProjectRelation{
			{ID: "rel:bundle:records", Type: "storage.bundle.uses_record_store", From: "storage.bundle:appStorage", To: "storage.recordStore:records", Fidelity: "resolved"},
			{ID: "rel:workspace:storage", Type: "workspace.uses_storage", From: "workspace:docs", To: "storage.bundle:appStorage", Fidelity: "resolved"},
		},
	})
	client := NewDirectClientFromService(NewService(s, nil))

	index, err := client.ProjectIndex(ctx)
	if err != nil {
		t.Fatalf("ProjectIndex error = %v", err)
	}
	definition := findAPIDefinition(index.Definitions, "storage.bundle:appStorage")
	if definition == nil {
		t.Fatalf("definitions = %+v, want storage bundle", index.Definitions)
	}
	storage := apiMapValue(t, definition.Metadata, "storage")
	components := apiMapValue(t, storage, "components")
	if components["recordStoreId"] != "storage.recordStore:records" {
		t.Fatalf("components = %+v, want record store id", components)
	}
	if !apiStorageWarningsInclude(storage, "storage.workspace_asset_missing") {
		t.Fatalf("storage = %+v, want workspace missing asset warning", storage)
	}
}

func findAPIDefinition(definitions []api.ProjectDefinition, id string) *api.ProjectDefinition {
	for i := range definitions {
		if definitions[i].ID == id {
			return &definitions[i]
		}
	}
	return nil
}

func apiMapValue(t *testing.T, data any, key string) map[string]any {
	t.Helper()
	var values map[string]any
	switch value := data.(type) {
	case json.RawMessage:
		if err := json.Unmarshal(value, &values); err != nil {
			t.Fatalf("decode API metadata: %v", err)
		}
	case map[string]any:
		values = value
	default:
		t.Fatalf("metadata = %T, want JSON object", data)
	}
	nested, ok := values[key].(map[string]any)
	if !ok {
		t.Fatalf("%s = %+v, want object", key, values[key])
	}
	return nested
}

func apiStorageWarningsInclude(storage map[string]any, code string) bool {
	warnings, _ := storage["warnings"].([]any)
	for _, warning := range warnings {
		row, ok := warning.(map[string]any)
		if ok && row["code"] == code {
			return true
		}
	}
	return false
}
