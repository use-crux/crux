package cache

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestSnapshotEpoch34IgnoresEpoch33ThenReindexesAndReloads(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	stalePatch := IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseAST,
		Project:       store.ProjectIdentity{Root: root, Name: "media"},
		FinishedAt:    "2026-07-12T00:00:01Z",
		Status:        "ok",
		Invalidates:   &IndexPatchInvalidation{All: true},
		Facts: IndexPatchFacts{Definitions: []store.ProjectDefinition{
			{ID: "media.operation:stale", Kind: "media.operation", Name: "stale", Fidelity: "resolved", Status: "active"},
		}},
	}
	if err := NewSQLiteIndexFactStore().CommitPhase(ctx, FactTransactionFromPatch(stalePatch)); err != nil {
		t.Fatalf("seed epoch 34 store before downgrade: %v", err)
	}

	currentDir := filepath.Dir(projectIndexFactStoreDBFile(root))
	staleDir := filepath.Join(root, ".crux", "cache", "index-v2", "epoch-33")
	if err := os.Rename(currentDir, staleDir); err != nil {
		t.Fatalf("move seeded cache to epoch 33: %v", err)
	}
	staleDB := filepath.Join(staleDir, "index.db")

	facts := NewSQLiteIndexFactStore()
	if index, ok, err := facts.LoadSnapshot(ctx, root, "media", time.Now()); err != nil {
		t.Fatalf("restart load with only epoch 33: %v", err)
	} else if ok {
		t.Fatalf("restart loaded stale epoch 33 snapshot: %+v", index.Definitions)
	}

	freshPatch := stalePatch
	freshPatch.FinishedAt = "2026-07-12T00:01:01Z"
	freshPatch.Facts.Definitions = []store.ProjectDefinition{
		{ID: "media.operation:fresh", Kind: "media.operation", Name: "fresh", Fidelity: "resolved", Status: "active"},
	}
	if err := facts.CommitPhase(ctx, FactTransactionFromPatch(freshPatch)); err != nil {
		t.Fatalf("reindex into epoch 34: %v", err)
	}

	reloaded, ok, err := NewSQLiteIndexFactStore().LoadSnapshot(ctx, root, "media", time.Now())
	if err != nil {
		t.Fatalf("reload epoch 34 after reindex: %v", err)
	}
	if !ok || findTestDefinition(reloaded.Definitions, "media.operation:fresh") == nil {
		t.Fatalf("reloaded definitions = %+v, want fresh epoch 34 fact", reloaded.Definitions)
	}
	if findTestDefinition(reloaded.Definitions, "media.operation:stale") != nil {
		t.Fatalf("reloaded stale epoch 33 fact: %+v", reloaded.Definitions)
	}
	if _, err := os.Stat(staleDB); err != nil {
		t.Fatalf("epoch 33 cache was deleted during migration: %v", err)
	}
}

func TestSQLiteIndexFactStoreProjectsCommittedPhaseFacts(t *testing.T) {
	root := t.TempDir()
	facts := NewSQLiteIndexFactStore()
	ctx := context.Background()

	patch := IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseAST,
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
				ProducedBy:    "@use-crux/indexer",
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

func TestSQLiteIndexFactStoreClearsFactsWithoutEnvelopeMetadata(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	db, err := openProjectIndexFactDB(root)
	if err != nil {
		t.Fatalf("open fact db: %v", err)
	}
	defer db.Close()

	for _, statement := range []string{
		`CREATE TABLE index_snapshot_state (
			root TEXT PRIMARY KEY,
			schema_version INTEGER NOT NULL DEFAULT 0,
			project_json TEXT,
			indexed_at TEXT,
			indexing_json TEXT,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE index_phase_state (
			root TEXT NOT NULL,
			phase TEXT NOT NULL,
			patch_json TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (root, phase)
		)`,
		`CREATE TABLE index_facts (
			root TEXT NOT NULL,
			phase TEXT NOT NULL,
			fact_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			source_file TEXT,
			producer_name TEXT NOT NULL,
			producer_version TEXT NOT NULL,
			invalidation_key TEXT,
			sequence INTEGER NOT NULL,
			fact_json TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (root, phase, fact_id)
		)`,
	} {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			t.Fatalf("create old fact schema: %v", err)
		}
	}

	patch := IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseAST,
		Project:       store.ProjectIdentity{Root: root, Name: "project"},
		Status:        "ok",
	}
	patchJSON, err := json.Marshal(patch)
	if err != nil {
		t.Fatalf("marshal patch: %v", err)
	}
	projectJSON, err := json.Marshal(store.ProjectIdentity{Root: root, Name: "project"})
	if err != nil {
		t.Fatalf("marshal project: %v", err)
	}
	definitionJSON, err := json.Marshal(testDefinition("prompt:old-cache", "src/old.ts"))
	if err != nil {
		t.Fatalf("marshal definition: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO index_snapshot_state (root, schema_version, project_json, indexed_at) VALUES (?, 1, ?, ?)`, root, string(projectJSON), "2026-06-18T10:00:01Z"); err != nil {
		t.Fatalf("insert old snapshot state: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO index_phase_state (root, phase, patch_json) VALUES (?, 'ast', ?)`, root, string(patchJSON)); err != nil {
		t.Fatalf("insert old phase state: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO index_facts (root, phase, fact_id, kind, producer_name, producer_version, sequence, fact_json)
		VALUES (?, 'ast', 'definitions:prompt:old-cache', 'definitions', '@use-crux/indexer/project-indexer', 'test', 0, ?)
	`, root, string(definitionJSON)); err != nil {
		t.Fatalf("insert old fact row: %v", err)
	}

	facts := NewSQLiteIndexFactStore()
	if _, ok, err := facts.ProjectSnapshot(ctx, root, "project"); err != nil {
		t.Fatalf("ProjectSnapshot error = %v", err)
	} else if ok {
		t.Fatal("ProjectSnapshot ok = true, want old cache cleared")
	}

	var factCount int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM index_facts`).Scan(&factCount); err != nil {
		t.Fatalf("count facts after migration: %v", err)
	}
	if factCount != 0 {
		t.Fatalf("fact count = %d, want old rows cleared", factCount)
	}
}

func TestSQLiteIndexFactStoreProjectsStorageFactsForReplay(t *testing.T) {
	root := t.TempDir()
	facts := NewSQLiteIndexFactStore()
	ctx := context.Background()
	storageDef := store.ProjectDefinition{
		ID:       "storage.bundle:appStorage",
		Kind:     "storage.bundle",
		Name:     "appStorage",
		Fidelity: "resolved",
		Status:   "active",
		Metadata: json.RawMessage(`{"facts":{"kind":"storage.bundle","records":"records"}}`),
	}
	recordDef := store.ProjectDefinition{
		ID:       "storage.recordStore:records",
		Kind:     "storage.recordStore",
		Name:     "records",
		Fidelity: "resolved",
		Status:   "active",
		Metadata: json.RawMessage(`{"facts":{"kind":"storage.recordStore","backend":"inMemoryRecordStore","capabilities":{"record":{"ttl":"lazy","filter":"scan"}}}}`),
	}
	relation := store.ProjectRelation{
		ID:       "relation:storage:records",
		Type:     "storage.bundle.uses_record_store",
		From:     "storage.bundle:appStorage",
		To:       "storage.recordStore:records",
		Fidelity: "resolved",
	}
	patch := IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseAST,
		Project:       store.ProjectIdentity{Root: root, Name: "project"},
		FinishedAt:    "2026-06-18T10:00:01Z",
		Status:        "ok",
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{storageDef, recordDef},
			Relations:   []store.ProjectRelation{relation},
		},
	}

	if err := facts.CommitPhase(ctx, IndexFactTransaction{
		Patch: patch,
		Facts: []IndexFactEnvelope{
			testIndexFactEnvelope(t, patch, "definitions:storage.bundle:appStorage", "definitions", storageDef),
			testIndexFactEnvelope(t, patch, "definitions:storage.recordStore:records", "definitions", recordDef),
			testIndexFactEnvelope(t, patch, "relations:storage.bundle.uses_record_store", "relations", relation),
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
	if findTestDefinition(projected.Definitions, "storage.bundle:appStorage") == nil {
		t.Fatalf("definitions = %+v, want storage bundle", projected.Definitions)
	}
	if findTestDefinition(projected.Definitions, "storage.recordStore:records") == nil {
		t.Fatalf("definitions = %+v, want record store", projected.Definitions)
	}
	if findTestRelation(projected.Relations, "relation:storage:records") == nil {
		t.Fatalf("relations = %+v, want storage relation", projected.Relations)
	}
}

func TestSQLiteIndexFactStoreInvalidatesFactsBySourceFile(t *testing.T) {
	root := t.TempDir()
	facts := NewSQLiteIndexFactStore()
	ctx := context.Background()

	initial := IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseAST,
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
	if err := facts.CommitPhase(ctx, FactTransactionFromPatch(initial)); err != nil {
		t.Fatalf("CommitPhase(initial) error = %v", err)
	}

	incremental := IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseAST,
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
	if err := facts.CommitPhase(ctx, FactTransactionFromPatch(incremental)); err != nil {
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
		Producer:      IndexFactProducer{Name: "@use-crux/indexer/project-indexer", Version: "test"},
		Fidelity:      "inferred",
		Provenance:    IndexFactProvenance{Kind: "runtime", Attribute: "project-index.ast"},
		Fact:          payload,
	}
}

func testDefinition(id string, file string) store.ProjectDefinition {
	return store.ProjectDefinition{
		ID:       id,
		Kind:     "prompt",
		Name:     id,
		Fidelity: "resolved",
		Status:   "active",
		Source:   &store.SourceLoc{File: file, Line: 1},
	}
}

func findTestDefinition(definitions []store.ProjectDefinition, id string) *store.ProjectDefinition {
	for i := range definitions {
		if definitions[i].ID == id {
			return &definitions[i]
		}
	}
	return nil
}

func findTestRelation(relations []store.ProjectRelation, id string) *store.ProjectRelation {
	for i := range relations {
		if relations[i].ID == id {
			return &relations[i]
		}
	}
	return nil
}

func findTestDiagnostic(diagnostics []store.IndexDiagnostic, id string) *store.IndexDiagnostic {
	for i := range diagnostics {
		if diagnostics[i].ID == id {
			return &diagnostics[i]
		}
	}
	return nil
}

func findTestSource(sources []store.IndexSourceFile, file string) *store.IndexSourceFile {
	for i := range sources {
		if sources[i].File == file {
			return &sources[i]
		}
	}
	return nil
}
