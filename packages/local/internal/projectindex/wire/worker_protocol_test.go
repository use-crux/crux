package wire

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
					"producer":      map[string]any{"name": "@use-crux/indexer", "version": "test"},
					"fidelity":      "inferred",
					"provenance":    map[string]any{"kind": "runtime", "attribute": "project-index.ast"},
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
					"producer":      map[string]any{"name": "@use-crux/indexer", "version": "test"},
					"fidelity":      "inferred",
					"provenance":    map[string]any{"kind": "runtime", "attribute": "project-index.ast"},
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
					"producer":      map[string]any{"name": "@use-crux/indexer", "version": "test"},
					"fidelity":      "inferred",
					"provenance":    map[string]any{"kind": "runtime", "attribute": "project-index.ast"},
					"fact": map[string]any{
						"file":          "/repo/src/writer.ts",
						"status":        "active",
						"shardId":       ".",
						"definitionIds": []string{"prompt:writer"},
						"diagnostics":   []string{"diagnostic:writer"},
					},
				},
				{
					"schemaVersion": 1,
					"factId":        "sourceGraph:0",
					"kind":          "sourceGraph",
					"phase":         "ast",
					"projectRoot":   "/repo",
					"producer":      map[string]any{"name": "@use-crux/indexer", "version": "test"},
					"fidelity":      "inferred",
					"provenance":    map[string]any{"kind": "runtime", "attribute": "project-index.ast"},
					"fact": map[string]any{
						"schemaVersion": 1,
						"producedBy":    "@use-crux/indexer",
						"capabilities":  []string{"project-shards"},
						"shards": []map[string]any{
							{"id": ".", "root": "/repo", "packageFile": "/repo/package.json"},
						},
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
			"summary": map[string]any{
				"factCount": 4,
				"timings": []map[string]any{
					{"name": "static.cache.read", "durationMs": 12.5, "count": 2},
				},
			},
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
	if patch.Phase != PhaseAST || patch.Project.Root != "/repo" || patch.Status != "ok" {
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
	if patch.Facts.Sources[0].ShardID != "." {
		t.Fatalf("source shardId = %q, want .", patch.Facts.Sources[0].ShardID)
	}
	if patch.Facts.SourceGraph == nil || len(patch.Facts.SourceGraph.Shards) != 1 || patch.Facts.SourceGraph.Shards[0].ID != "." {
		t.Fatalf("sourceGraph = %+v, want root shard", patch.Facts.SourceGraph)
	}
	timings := collector.Timings()
	if len(timings) != 1 || timings[0].Name != "static.cache.read" || timings[0].DurationMs != 12.5 || timings[0].Count != 2 {
		t.Fatalf("timings = %+v, want static.cache.read summary", timings)
	}
}

func TestProjectIndexPatchStreamCollectorBuildsSemanticSourceProfileFromBatches(t *testing.T) {
	collector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{Root: "/repo"})

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
			"type":            "sourceProfile:batch",
			"transactionId":   "tx-ast",
			"sequence":        0,
			"files": []map[string]any{
				{
					"file":        "/repo/src/a.ts",
					"sourceHash":  "hash-a",
					"sourceBytes": 12,
					"hints": map[string]any{
						"nativeDirectCruxCandidate": true,
						"cruxCallNames":             []string{"prompt"},
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
				"project":       map[string]any{"root": "/repo"},
				"startedAt":     "2026-06-18T10:00:00.000Z",
				"finishedAt":    "2026-06-18T10:00:00.001Z",
				"status":        "ok",
			},
			"summary": map[string]any{"factCount": 0},
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
	profile := patches[0].SemanticSourceProfile
	if profile == nil || len(profile.Files) != 1 {
		t.Fatalf("semantic source profile = %+v, want streamed profile file", profile)
	}
	if profile.SourceBytes != 12 || !profile.Complete {
		t.Fatalf("semantic source profile = %+v, want byte count and complete marker", profile)
	}
	if profile.Files[0].Hints == nil || !profile.Files[0].Hints.NativeDirectCruxCandidate {
		t.Fatalf("semantic source profile hints = %+v, want native candidate", profile.Files[0].Hints)
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
		Producer: "@use-crux/indexer/project-indexer",
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

func TestProjectIndexPatchStreamCollectorPreservesRuntimeObservedEnvelopeMetadata(t *testing.T) {
	collector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{Root: "/repo"})
	if err := collector.Handle(mustMarshalWorkerEvent(t, map[string]any{
		"protocolVersion": 2,
		"type":            "phase:start",
		"transactionId":   "tx-runtime",
		"phase":           "runtime",
		"root":            "/repo",
		"startedAt":       "2026-06-20T10:00:00.000Z",
	})); err != nil {
		t.Fatalf("Handle phase:start error = %v", err)
	}
	if err := collector.Handle(mustMarshalWorkerEvent(t, map[string]any{
		"protocolVersion": 2,
		"type":            "fact:batch",
		"transactionId":   "tx-runtime",
		"sequence":        0,
		"facts": []map[string]any{{
			"schemaVersion": 1,
			"factId":        "definitions:prompt:runtime",
			"kind":          "definitions",
			"phase":         "runtime",
			"projectRoot":   "/repo",
			"producer":      map[string]any{"name": "@use-crux/indexer/project-runtime-indexer", "version": "test"},
			"fidelity":      "runtime-observed",
			"provenance":    map[string]any{"kind": "runtime", "attribute": "project-index.runtime"},
			"fact": map[string]any{
				"id":       "prompt:runtime",
				"kind":     "prompt",
				"name":     "runtime",
				"fidelity": "resolved",
				"status":   "active",
			},
		}},
	})); err != nil {
		t.Fatalf("Handle fact:batch error = %v", err)
	}
	if err := collector.Handle(mustMarshalWorkerEvent(t, map[string]any{
		"protocolVersion": 2,
		"type":            "phase:done",
		"transactionId":   "tx-runtime",
		"phase":           "runtime",
		"patch": map[string]any{
			"schemaVersion": 1,
			"phase":         "runtime",
			"project":       map[string]any{"root": "/repo"},
			"startedAt":     "2026-06-20T10:00:00.000Z",
			"finishedAt":    "2026-06-20T10:00:00.001Z",
			"status":        "ok",
		},
		"summary": map[string]any{"factCount": 1},
	})); err != nil {
		t.Fatalf("Handle phase:done error = %v", err)
	}

	patches, err := collector.Patches()
	if err != nil {
		t.Fatalf("Patches error = %v", err)
	}
	envelopes := patches[0].FactEnvelopes
	if len(envelopes) != 1 {
		t.Fatalf("fact envelopes = %+v, want one runtime envelope", envelopes)
	}
	if envelopes[0].Fidelity != "runtime-observed" || envelopes[0].Provenance.Attribute != "project-index.runtime" {
		t.Fatalf("runtime envelope metadata = %+v, want runtime observed provenance", envelopes[0])
	}
}

func testDefinitionFact(id string) map[string]any {
	return map[string]any{
		"schemaVersion": 1,
		"factId":        "definitions:" + id,
		"kind":          "definitions",
		"phase":         "ast",
		"projectRoot":   "/repo",
		"producer":      map[string]any{"name": "@use-crux/indexer", "version": "test"},
		"fidelity":      "inferred",
		"provenance":    map[string]any{"kind": "runtime", "attribute": "project-index.ast"},
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
