package readmodel

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestStorePublicationSnapshotIsCoherentDetachedAndIdentified(t *testing.T) {
	store := NewStore()
	firstGeneration := uint64(4)
	store.ApplySnapshot("scope", publicationFixture("a", "a.ts", &firstGeneration))
	captured := store.PublicationSnapshot("scope")

	secondGeneration := uint64(5)
	store.ApplySnapshot("scope", publicationFixture("b", "b.ts", &secondGeneration))
	if !captured.GenerationKnown || captured.Generation != 4 || captured.Revision != 1 {
		t.Fatalf("captured identity = generation %d known=%v revision=%d", captured.Generation, captured.GenerationKnown, captured.Revision)
	}
	assertFindingIDs(t, captured.Findings["a.ts"], []string{"finding:a"})
	if captured.DefinitionsByID["a"].ID != "a" || len(captured.DefinitionsByFile["a.ts"]) != 1 ||
		captured.Relations[0].ID != "relation:a" ||
		captured.SitesByFile["a.ts"][0].TargetDefinitionID != "a" {
		t.Fatalf("captured publication mixed generations: %#v", captured)
	}
	if _, exists := captured.DefinitionsByID["b"]; exists {
		t.Fatalf("captured publication observed later definition: %#v", captured.DefinitionsByID)
	}

	captured.DefinitionsByFile["a.ts"][0].Tags[0] = "mutated"
	*captured.SitesByFile["a.ts"][0].Source.Column = 99
	again := store.PublicationSnapshot("scope")
	if again.Revision != 2 || again.DefinitionsByID["b"].Tags[0] != "stable" ||
		*again.SitesByFile["b.ts"][0].Source.Column != 1 {
		t.Fatalf("publication was not detached or current: %#v", again)
	}
}

func TestStorePublicationRetainsDetachedDiagnosticsSourcesAndIndexing(t *testing.T) {
	t.Parallel()

	const file = "/repo/writer.ts"
	generation := uint64(3)
	store := NewStore()
	store.ApplySnapshot("scope", Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
			Cache:    &api.IndexIndexingCacheStatus{Status: "stale"},
		},
		Diagnostics: []api.IndexDiagnostic{{
			ID: "diagnostic:writer", Source: &api.SourceLoc{File: file, Line: 1},
			RelatedDefinitionIDs: []string{"prompt:writer"},
		}},
		Sources: []api.IndexSourceFile{{
			File: file, SourceHash: "writer-hash",
			DefinitionIDs: []string{"prompt:writer"},
		}},
	})

	publication := store.PublicationSnapshot("scope")
	if publication.Indexing == nil || publication.Indexing.Semantic.Status != "ready" {
		t.Fatalf("indexing = %#v, want semantic ready", publication.Indexing)
	}
	if publication.Diagnostics[file][0].ID != "diagnostic:writer" {
		t.Fatalf("diagnostics = %#v, want source-grouped diagnostic", publication.Diagnostics)
	}
	if publication.SourcesByFile[file].SourceHash != "writer-hash" {
		t.Fatalf("sources = %#v, want source row", publication.SourcesByFile)
	}

	publication.Diagnostics[file][0].RelatedDefinitionIDs[0] = "mutated"
	publication.SourcesByFile[file] = api.IndexSourceFile{File: file, SourceHash: "mutated"}
	publication.Indexing.Cache.Status = "mutated"
	again := store.PublicationSnapshot("scope")
	if again.Diagnostics[file][0].RelatedDefinitionIDs[0] != "prompt:writer" ||
		again.SourcesByFile[file].SourceHash != "writer-hash" ||
		again.Indexing.Cache.Status != "stale" {
		t.Fatalf("publication was not detached: %#v", again)
	}
}

func publicationFixture(id, file string, generation *uint64) Snapshot {
	column := 1
	return Snapshot{
		Generation: generation,
		Findings: []api.IndexLintFinding{{
			ID: "finding:" + id, RuleID: "test.rule", Profiles: []string{"recommended"},
			Source: &api.SourceLoc{File: file, Line: 1, Column: &column},
		}},
		Definitions: []api.ProjectDefinition{{
			ID: id, Tags: []string{"stable"}, Source: &api.SourceLoc{File: file, Line: 1, Column: &column},
			SourceRefs: []api.ProjectSourceRef{{
				ID: "ref:" + id, Source: api.SourceLoc{File: file, Line: 1, Column: &column},
			}},
		}},
		Relations: []api.ProjectRelation{{
			ID: "relation:" + id, From: id, To: "target:" + id,
		}},
	}
}
