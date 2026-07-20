package model_test

import (
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/eventwire"
	"github.com/use-crux/crux/packages/local/internal/projectindex/model"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestStreamedSuccessfulRuntimePatchClearsPriorDiagnostic(t *testing.T) {
	state := model.ApplyPatch(model.EmptyPatchState(), model.IndexPatch{
		SchemaVersion: 1,
		Phase:         model.PhaseRuntime,
		Project:       store.ProjectIdentity{Root: "/repo"},
		Status:        "degraded",
		Facts: model.IndexPatchFacts{Diagnostics: []store.IndexDiagnostic{{
			ID: "diagnostic:runtime:degraded", Code: "index.runtime_degraded", Severity: "info",
		}}},
	})

	collector := eventwire.NewProjectIndexPatchStreamCollector(eventwire.ProjectIndexPatchStreamOptions{Root: "/repo"})
	events := []string{
		`{"protocolVersion":2,"type":"phase:start","transactionId":"runtime-recovery","phase":"runtime","root":"/repo","startedAt":"2026-07-20T00:00:00Z"}`,
		`{"protocolVersion":2,"type":"phase:done","transactionId":"runtime-recovery","phase":"runtime","patch":{"schemaVersion":1,"phase":"runtime","project":{"root":"/repo"},"startedAt":"2026-07-20T00:00:00Z","finishedAt":"2026-07-20T00:00:01Z","status":"ok"},"summary":{"factCount":0}}`,
	}
	for _, event := range events {
		if err := collector.Handle(json.RawMessage(event)); err != nil {
			t.Fatal(err)
		}
	}
	patches, err := collector.Patches()
	if err != nil {
		t.Fatal(err)
	}
	if patches[0].Facts.Diagnostics != nil {
		t.Fatalf("wire diagnostics = %#v, want nil production representation", patches[0].Facts.Diagnostics)
	}

	recovered := model.ApplyPatch(state, patches[0])
	for _, diagnostic := range recovered.Index.Diagnostics {
		if diagnostic.ID == "diagnostic:runtime:degraded" {
			t.Fatalf("recovered diagnostics = %+v, want stale runtime diagnostic cleared", recovered.Index.Diagnostics)
		}
	}
}
