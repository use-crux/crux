package quality

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/qualityfs"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestConnectedFixtureCorrelatesQualityExperimentWithDefinitionBearingRun(t *testing.T) {
	ctx := context.Background()
	obs, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer obs.Close()

	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{"schemaVersion":2,"records":[
		{"schemaVersion":2,"recordId":"connected-quality-start","type":"run:start","runId":"run_connected_quality","traceId":"trace_connected_quality","segmentId":"seg_connected_quality","segmentSeq":1,"name":"connected quality","rootPrimitive":"eval.case","startedAt":"2026-07-01T15:00:00.000Z","status":"running"},
		{"schemaVersion":2,"recordId":"connected-quality-judge","type":"span","runId":"run_connected_quality","traceId":"trace_connected_quality","segmentId":"seg_connected_quality","segmentSeq":2,"spanId":"span_connected_quality_judge","family":"scoring","primitive":"scoring.judge","name":"judge.connected","startedAt":"2026-07-01T15:00:00.100Z","status":"ok","definitionRefs":[{"id":"scorer:connected","kind":"scorer","role":"invoked-scorer"}]},
		{"schemaVersion":2,"recordId":"connected-quality-end","type":"run:end","runId":"run_connected_quality","traceId":"trace_connected_quality","segmentId":"seg_connected_quality","segmentSeq":3,"endedAt":"2026-07-01T15:00:01.000Z","status":"ok"}
	]}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	if _, err := qualityfs.Put(qualityfs.Open(dir), qualityExperimentRecord{
		Tag: "QualityExperiment", ID: "experiment-connected", QualityID: "connected",
		StartedAt: "2026-07-01T15:00:00.000Z", EndedAt: "2026-07-01T15:00:01.000Z", Status: "completed",
		Cases: []qualityExperimentCase{{CaseID: "case-connected", VariantID: "default", Status: "passed", TraceID: "trace_connected_quality"}},
	}); err != nil {
		t.Fatal(err)
	}

	service := NewService(store.NewStore(), dir).WithObservability(obs)
	runs, err := service.RunsWithOptions(ctx, api.QualityRunsOptions{Has: []string{"experiment"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].TraceID != "run_connected_quality" || !containsString(runs[0].ExperimentIDs, "experiment-connected") {
		t.Fatalf("quality-correlated runs = %+v", runs)
	}
	scorer, err := obs.DefinitionActivitySummary(ctx, "scorer:connected")
	if err != nil || scorer.RunCount != 1 {
		t.Fatalf("scorer definition activity = %+v, err=%v", scorer, err)
	}
}
