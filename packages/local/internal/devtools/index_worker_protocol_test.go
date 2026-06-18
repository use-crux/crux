package devtools

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProjectIndexPatchStreamCollectorBuildsPatchFromOrderedBatches(t *testing.T) {
	collector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{
		Root:   "/repo",
		Budget: IndexPatchBudget{MaxDefinitions: 10, MaxDiagnostics: 10, MaxSources: 10, MaxBytes: 1024 * 1024},
	})

	events := []map[string]any{
		{
			"protocolVersion": 2,
			"type":            "phase:start",
			"transactionId":   "tx-ast",
			"phase":           "ast",
			"root":            "/repo",
			"startedAt":       "2026-06-18T10:00:00.000Z",
		},
		{
			"protocolVersion": 2,
			"type":            "fact:batch",
			"transactionId":   "tx-ast",
			"sequence":        0,
			"facts": []map[string]any{
				{
					"schemaVersion": 1,
					"factId":        "definitions:prompt:writer",
					"kind":          "definitions",
					"phase":         "ast",
					"projectRoot":   "/repo",
					"producer":      map[string]any{"name": "@crux/indexer", "version": "test"},
					"fact": map[string]any{
						"id":       "prompt:writer",
						"kind":     "prompt",
						"name":     "writer",
						"fidelity": "partial",
						"status":   "active",
					},
				},
				{
					"schemaVersion": 1,
					"factId":        "diagnostics:diagnostic:writer",
					"kind":          "diagnostics",
					"phase":         "ast",
					"projectRoot":   "/repo",
					"producer":      map[string]any{"name": "@crux/indexer", "version": "test"},
					"fact": map[string]any{
						"id":       "diagnostic:writer",
						"severity": "info",
						"code":     "index.writer",
						"message":  "writer indexed",
					},
				},
			},
		},
		{
			"protocolVersion": 2,
			"type":            "fact:batch",
			"transactionId":   "tx-ast",
			"sequence":        1,
			"facts": []map[string]any{
				{
					"schemaVersion": 1,
					"factId":        "sources:/repo/src/writer.ts",
					"kind":          "sources",
					"phase":         "ast",
					"projectRoot":   "/repo",
					"producer":      map[string]any{"name": "@crux/indexer", "version": "test"},
					"fact": map[string]any{
						"file":          "/repo/src/writer.ts",
						"status":        "active",
						"definitionIds": []string{"prompt:writer"},
						"diagnostics":   []string{"diagnostic:writer"},
					},
				},
			},
		},
		{
			"protocolVersion": 2,
			"type":            "phase:done",
			"transactionId":   "tx-ast",
			"phase":           "ast",
			"patch": map[string]any{
				"schemaVersion": 1,
				"phase":         "ast",
				"project":       map[string]any{"root": "/repo", "name": "fixture"},
				"startedAt":     "2026-06-18T10:00:00.000Z",
				"finishedAt":    "2026-06-18T10:00:00.001Z",
				"status":        "ok",
				"invalidates":   map[string]any{"all": true},
			},
			"summary": map[string]any{"factCount": 3},
		},
	}

	for _, event := range events {
		if err := collector.Handle(mustMarshalWorkerEvent(t, event)); err != nil {
			t.Fatalf("Handle(%s) error = %v", event["type"], err)
		}
	}

	patches, err := collector.Patches()
	if err != nil {
		t.Fatalf("Patches error = %v", err)
	}
	if len(patches) != 1 {
		t.Fatalf("patches len = %d, want 1", len(patches))
	}
	patch := patches[0]
	if patch.Phase != indexPatchPhaseAST || patch.Project.Root != "/repo" || patch.Status != "ok" {
		t.Fatalf("patch metadata = %+v", patch)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:writer" {
		t.Fatalf("definitions = %+v, want prompt:writer", patch.Facts.Definitions)
	}
	if len(patch.Facts.Diagnostics) != 1 || patch.Facts.Diagnostics[0].Code != "index.writer" {
		t.Fatalf("diagnostics = %+v, want index.writer", patch.Facts.Diagnostics)
	}
	if len(patch.Facts.Sources) != 1 || patch.Facts.Sources[0].File != "/repo/src/writer.ts" {
		t.Fatalf("sources = %+v, want writer source", patch.Facts.Sources)
	}
}

func TestProjectIndexPatchStreamCollectorRejectsSequenceGaps(t *testing.T) {
	collector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{Root: "/repo"})

	if err := collector.Handle(mustMarshalWorkerEvent(t, map[string]any{
		"protocolVersion": 2,
		"type":            "phase:start",
		"transactionId":   "tx-ast",
		"phase":           "ast",
		"root":            "/repo",
		"startedAt":       "2026-06-18T10:00:00.000Z",
	})); err != nil {
		t.Fatalf("Handle phase:start error = %v", err)
	}

	err := collector.Handle(mustMarshalWorkerEvent(t, map[string]any{
		"protocolVersion": 2,
		"type":            "fact:batch",
		"transactionId":   "tx-ast",
		"sequence":        1,
		"facts":           []map[string]any{},
	}))

	if err == nil || !strings.Contains(err.Error(), "sequence") {
		t.Fatalf("Handle sequence gap error = %v, want sequence error", err)
	}
}

func TestProjectIndexPatchStreamCollectorRejectsRootMismatch(t *testing.T) {
	collector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{Root: "/repo"})

	err := collector.Handle(mustMarshalWorkerEvent(t, map[string]any{
		"protocolVersion": 2,
		"type":            "phase:start",
		"transactionId":   "tx-ast",
		"phase":           "ast",
		"root":            "/other",
		"startedAt":       "2026-06-18T10:00:00.000Z",
	}))

	if err == nil || !strings.Contains(err.Error(), "root") {
		t.Fatalf("Handle root mismatch error = %v, want root error", err)
	}
}

func TestProjectIndexPatchStreamCollectorRejectsPatchBudgetViolations(t *testing.T) {
	collector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{
		Root:   "/repo",
		Budget: IndexPatchBudget{MaxDefinitions: 1},
	})

	events := []map[string]any{
		{
			"protocolVersion": 2,
			"type":            "phase:start",
			"transactionId":   "tx-ast",
			"phase":           "ast",
			"root":            "/repo",
			"startedAt":       "2026-06-18T10:00:00.000Z",
		},
		{
			"protocolVersion": 2,
			"type":            "fact:batch",
			"transactionId":   "tx-ast",
			"sequence":        0,
			"facts": []map[string]any{
				testDefinitionFact("prompt:one"),
				testDefinitionFact("prompt:two"),
			},
		},
	}
	for _, event := range events {
		if err := collector.Handle(mustMarshalWorkerEvent(t, event)); err != nil {
			t.Fatalf("Handle(%s) error = %v", event["type"], err)
		}
	}

	err := collector.Handle(mustMarshalWorkerEvent(t, map[string]any{
		"protocolVersion": 2,
		"type":            "phase:done",
		"transactionId":   "tx-ast",
		"phase":           "ast",
		"patch": map[string]any{
			"schemaVersion": 1,
			"phase":         "ast",
			"project":       map[string]any{"root": "/repo"},
			"startedAt":     "2026-06-18T10:00:00.000Z",
			"finishedAt":    "2026-06-18T10:00:00.001Z",
			"status":        "ok",
		},
		"summary": map[string]any{"factCount": 2},
	}))

	if err == nil || !strings.Contains(err.Error(), "definitions 2/1") {
		t.Fatalf("Handle budget violation error = %v, want definitions budget error", err)
	}
}

func TestProjectIndexPatchStreamCollectorRejectsProducerMismatch(t *testing.T) {
	collector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{
		Root:     "/repo",
		Producer: "@crux/indexer/project-indexer",
	})

	if err := collector.Handle(mustMarshalWorkerEvent(t, map[string]any{
		"protocolVersion": 2,
		"type":            "phase:start",
		"transactionId":   "tx-ast",
		"phase":           "ast",
		"root":            "/repo",
		"startedAt":       "2026-06-18T10:00:00.000Z",
	})); err != nil {
		t.Fatalf("Handle phase:start error = %v", err)
	}

	err := collector.Handle(mustMarshalWorkerEvent(t, map[string]any{
		"protocolVersion": 2,
		"type":            "fact:batch",
		"transactionId":   "tx-ast",
		"sequence":        0,
		"facts":           []map[string]any{testDefinitionFact("prompt:writer")},
	}))

	if err == nil || !strings.Contains(err.Error(), "producer") {
		t.Fatalf("Handle producer mismatch error = %v, want producer error", err)
	}
}

func testDefinitionFact(id string) map[string]any {
	return map[string]any{
		"schemaVersion": 1,
		"factId":        "definitions:" + id,
		"kind":          "definitions",
		"phase":         "ast",
		"projectRoot":   "/repo",
		"producer":      map[string]any{"name": "@crux/indexer", "version": "test"},
		"fact": map[string]any{
			"id":       id,
			"kind":     "prompt",
			"name":     id,
			"fidelity": "partial",
			"status":   "active",
		},
	}
}

func mustMarshalWorkerEvent(t *testing.T, value any) json.RawMessage {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal event: %v", err)
	}
	return data
}
