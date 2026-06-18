package devtools

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestSQLiteIndexFactStoreProjectsCommittedPhaseFacts(t *testing.T) {
	root := t.TempDir()
	facts := NewSQLiteIndexFactStore()
	ctx := context.Background()

	patch := IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseAST,
		Project:       store.ProjectIdentity{Root: root, Name: "project"},
		StartedAt:     "2026-06-18T10:00:00Z",
		FinishedAt:    "2026-06-18T10:00:01Z",
		Status:        "ok",
		Invalidates:   &IndexPatchInvalidation{All: true},
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{
				testDefinition("prompt:writer", "src/writer.ts"),
			},
			Diagnostics: []store.IndexDiagnostic{
				{
					ID:       "diagnostic:writer",
					Severity: "info",
					Code:     "index.writer",
					Message:  "writer indexed",
					Source:   &store.SourceLoc{File: "src/writer.ts", Line: 1},
				},
			},
			Sources: []store.IndexSourceFile{
				{File: "src/writer.ts", Status: "active", ShardID: ".", DefinitionIDs: []string{"prompt:writer"}, Diagnostics: []string{"diagnostic:writer"}},
			},
			SourceGraph: &store.ProjectIndexSourceGraph{
				SchemaVersion: 1,
				ProducedBy:    "@crux/indexer",
				Capabilities:  []string{"source-dependencies", "source-dependents", "definition-ownership", "diagnostic-ownership", "project-shards"},
				Shards:        []store.ProjectIndexShard{{ID: ".", Root: root, PackageFile: root + "/package.json"}},
			},
		},
	}

	if err := facts.CommitPhase(ctx, IndexFactTransaction{
		Patch: patch,
		Facts: []IndexFactEnvelope{
			testIndexFactEnvelope(t, patch, "definitions:prompt:writer", "definitions", patch.Facts.Definitions[0]),
			testIndexFactEnvelope(t, patch, "diagnostics:diagnostic:writer", "diagnostics", patch.Facts.Diagnostics[0]),
			testIndexFactEnvelope(t, patch, "sources:src/writer.ts", "sources", patch.Facts.Sources[0]),
			testIndexFactEnvelope(t, patch, "sourceGraph:0", "sourceGraph", patch.Facts.SourceGraph),
		},
	}); err != nil {
		t.Fatalf("CommitPhase error = %v", err)
	}

	projected, ok, err := facts.ProjectSnapshot(ctx, root, "project")
	if err != nil {
		t.Fatalf("ProjectSnapshot error = %v", err)
	}
	if !ok {
		t.Fatal("ProjectSnapshot ok = false, want committed snapshot")
	}
	if projected.Project == nil || projected.Project.Root != root || projected.Project.Name != "project" {
		t.Fatalf("project = %+v, want committed project identity", projected.Project)
	}
	if projected.IndexedAt != "2026-06-18T10:00:01Z" {
		t.Fatalf("IndexedAt = %q, want patch finishedAt", projected.IndexedAt)
	}
	if findTestDefinition(projected.Definitions, "prompt:writer") == nil {
		t.Fatalf("definitions = %+v, want prompt:writer", projected.Definitions)
	}
	if findTestDiagnostic(projected.Diagnostics, "diagnostic:writer") == nil {
		t.Fatalf("diagnostics = %+v, want diagnostic:writer", projected.Diagnostics)
	}
	source := findTestSource(projected.Sources, "src/writer.ts")
	if source == nil {
		t.Fatalf("sources = %+v, want src/writer.ts", projected.Sources)
	}
	if source.ShardID != "." {
		t.Fatalf("source shardId = %q, want .", source.ShardID)
	}
	if projected.SourceGraph == nil || len(projected.SourceGraph.Shards) != 1 || projected.SourceGraph.Shards[0].ID != "." {
		t.Fatalf("sourceGraph = %+v, want root shard", projected.SourceGraph)
	}
}

func TestSQLiteIndexFactStoreInvalidatesFactsBySourceFile(t *testing.T) {
	root := t.TempDir()
	facts := NewSQLiteIndexFactStore()
	ctx := context.Background()

	initial := IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseAST,
		Project:       store.ProjectIdentity{Root: root, Name: "project"},
		StartedAt:     "2026-06-18T10:00:00Z",
		FinishedAt:    "2026-06-18T10:00:01Z",
		Status:        "ok",
		Invalidates:   &IndexPatchInvalidation{All: true},
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{
				testDefinition("prompt:a", "src/a.ts"),
				testDefinition("prompt:b", "src/b.ts"),
			},
			Relations: []store.ProjectRelation{
				{ID: "relation:a:b", Type: "prompt.uses_context", From: "prompt:a", To: "prompt:b", Fidelity: "resolved", Source: &store.SourceLoc{File: "src/a.ts", Line: 1}},
				{ID: "relation:b:c", Type: "prompt.uses_context", From: "prompt:b", To: "context:c", Fidelity: "resolved", Source: &store.SourceLoc{File: "src/b.ts", Line: 1}},
			},
			Sources: []store.IndexSourceFile{
				{File: "src/a.ts", Status: "active", DefinitionIDs: []string{"prompt:a"}},
				{File: "src/b.ts", Status: "active", DefinitionIDs: []string{"prompt:b"}},
			},
		},
	}
	if err := facts.CommitPhase(ctx, indexFactTransactionFromPatch(initial)); err != nil {
		t.Fatalf("CommitPhase(initial) error = %v", err)
	}

	incremental := IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseAST,
		Project:       store.ProjectIdentity{Root: root, Name: "project"},
		StartedAt:     "2026-06-18T10:01:00Z",
		FinishedAt:    "2026-06-18T10:01:01Z",
		Status:        "ok",
		Invalidates:   &IndexPatchInvalidation{Files: []string{"src/a.ts"}},
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{
				testDefinition("prompt:a2", "src/a.ts"),
			},
			Sources: []store.IndexSourceFile{
				{File: "src/a.ts", Status: "active", DefinitionIDs: []string{"prompt:a2"}},
			},
		},
	}
	if err := facts.CommitPhase(ctx, indexFactTransactionFromPatch(incremental)); err != nil {
		t.Fatalf("CommitPhase(incremental) error = %v", err)
	}

	projected, ok, err := facts.ProjectSnapshot(ctx, root, "project")
	if err != nil {
		t.Fatalf("ProjectSnapshot error = %v", err)
	}
	if !ok {
		t.Fatal("ProjectSnapshot ok = false, want committed snapshot")
	}
	if findTestDefinition(projected.Definitions, "prompt:a") != nil {
		t.Fatalf("stale invalidated definition survived: %+v", projected.Definitions)
	}
	if findTestDefinition(projected.Definitions, "prompt:a2") == nil {
		t.Fatalf("replacement definition missing: %+v", projected.Definitions)
	}
	if findTestDefinition(projected.Definitions, "prompt:b") == nil {
		t.Fatalf("unrelated definition removed: %+v", projected.Definitions)
	}
	if findTestRelation(projected.Relations, "relation:a:b") != nil {
		t.Fatalf("invalidated relation survived: %+v", projected.Relations)
	}
	if findTestRelation(projected.Relations, "relation:b:c") == nil {
		t.Fatalf("unrelated relation removed: %+v", projected.Relations)
	}
}

func testIndexFactEnvelope(t *testing.T, patch IndexPatch, id string, kind string, fact any) IndexFactEnvelope {
	t.Helper()
	payload, err := json.Marshal(fact)
	if err != nil {
		t.Fatalf("marshal fact %s: %v", id, err)
	}
	return IndexFactEnvelope{
		SchemaVersion: 1,
		FactID:        id,
		Kind:          kind,
		Phase:         patch.Phase,
		ProjectRoot:   patch.Project.Root,
		Producer:      IndexFactProducer{Name: "@crux/indexer/project-indexer", Version: "test"},
		Fact:          payload,
	}
}
