package readmodel

import (
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestDefinitionsInFileDerivesSortedDetachedSnapshotIndex(t *testing.T) {
	store := NewStore()
	columnOne, columnFour, columnFive, endLine := 1, 4, 5, 8
	definitions := []api.ProjectDefinition{
		{
			ID:     "snippet",
			Source: &api.SourceLoc{File: "fallback.ts", Line: 99},
			SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
				File: "target.ts", StartLine: 3, StartColumn: &columnFour, EndLine: &endLine,
			}},
			SourceRefs: []api.ProjectSourceRef{{
				ID: "ref", Metadata: map[string]any{"roles": []any{"prompt"}},
			}},
		},
		{
			ID:            "invalid-snippet-line-fallback",
			Source:        &api.SourceLoc{File: "target.ts", Line: 1},
			SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{File: "invalid.ts", StartLine: 0}},
		},
		{
			ID:            "empty-snippet-file-fallback",
			Source:        &api.SourceLoc{File: "target.ts", Line: 2, Column: &columnOne},
			SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{StartLine: 50}},
		},
		{ID: "fallback", Source: &api.SourceLoc{File: "target.ts", Line: 2, Column: &columnFive}},
		{ID: "same:z", Source: &api.SourceLoc{File: "target.ts", Line: 4, Column: &columnFive}},
		{ID: "same:a", Source: &api.SourceLoc{File: "target.ts", Line: 4, Column: &columnFive}},
		{ID: "missing-column", Source: &api.SourceLoc{File: "target.ts", Line: 4}},
		{
			ID:            "unusable",
			Source:        &api.SourceLoc{File: "", Line: 1},
			SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{File: "invalid.ts", StartLine: 0}},
		},
	}
	store.ApplySnapshot("scope", Snapshot{Definitions: definitions})

	columnFour = 40
	endLine = 80
	definitions[0].SourceRefs[0].Metadata["roles"].([]any)[0] = "mutated"

	got := store.DefinitionsInFile("scope", "target.ts")
	assertDefinitionIDs(t, got, []string{
		"invalid-snippet-line-fallback", "empty-snippet-file-fallback", "fallback", "snippet",
		"missing-column", "same:a", "same:z",
	})
	if got[3].SourceSnippet.Range.StartColumn == nil || *got[3].SourceSnippet.Range.StartColumn != 4 ||
		got[3].SourceSnippet.Range.EndLine == nil || *got[3].SourceSnippet.Range.EndLine != 8 {
		t.Fatalf("snippet range was not detached from snapshot input: %#v", got[3].SourceSnippet.Range)
	}
	if got[3].SourceRefs[0].Metadata["roles"].([]any)[0] != "prompt" {
		t.Fatalf("source-ref metadata was not detached from snapshot input: %#v", got[3].SourceRefs)
	}
	if fallback := store.DefinitionsInFile("scope", "fallback.ts"); fallback != nil {
		t.Fatalf("Source fallback overrode SourceSnippet binding: %#v", fallback)
	}
	if _, ok := store.Definition("scope", "unusable"); !ok {
		t.Fatal("definition with unusable location was not retained by ID")
	}

	*got[3].SourceSnippet.Range.StartColumn = 400
	got[3].SourceRefs[0].Metadata["roles"].([]any)[0] = "returned mutation"
	detached := store.DefinitionsInFile("scope", "target.ts")
	if *detached[3].SourceSnippet.Range.StartColumn != 4 ||
		detached[3].SourceRefs[0].Metadata["roles"].([]any)[0] != "prompt" {
		t.Fatalf("returned definitions were not deeply detached: %#v", detached[3])
	}
}

func TestDefinitionsInFileTracksDefinitionDeltasOnly(t *testing.T) {
	store := NewStore()
	generation := uint64(1)
	store.ApplySnapshot("scope", Snapshot{
		Generation: &generation,
		Definitions: []api.ProjectDefinition{
			{ID: "move", Source: &api.SourceLoc{File: "old.ts", Line: 1}},
			{ID: "remove", Source: &api.SourceLoc{File: "old.ts", Line: 2}},
			{ID: "keep", Source: &api.SourceLoc{File: "keep.ts", Line: 3}},
		},
	})

	result := store.ApplyDelta("scope", Delta{
		Generation: 2,
		File:       "old.ts",
		Definitions: DefinitionChanges{
			Added:      []api.ProjectDefinition{{ID: "add", Source: &api.SourceLoc{File: "new.ts", Line: 4}}},
			Changed:    []api.ProjectDefinition{{ID: "move", Source: &api.SourceLoc{File: "new.ts", Line: 5}}},
			RemovedIDs: []string{"remove"},
		},
	})
	if result.Status != DeltaApplied {
		t.Fatalf("definition delta status = %v, want applied", result.Status)
	}
	if old := store.DefinitionsInFile("scope", "old.ts"); old != nil {
		t.Fatalf("old file retained moved or removed definitions: %#v", old)
	}
	assertDefinitionIDs(t, store.DefinitionsInFile("scope", "new.ts"), []string{"add", "move"})
	if _, ok := store.Definition("scope", "remove"); ok {
		t.Fatal("removed definition was retained by ID")
	}

	moved := store.DefinitionsInFile("scope", "new.ts")
	moved[1].Source.File = "returned-mutation.ts"
	store.ApplyDelta("scope", Delta{
		Generation: 3,
		File:       "lint.ts",
		Lints:      &LintReplacement{Findings: []api.IndexLintFinding{finding("lint", "lint.ts")}},
	})
	store.ApplyDelta("scope", Delta{Generation: 4, File: "source.ts", SourceChanged: true})
	assertDefinitionIDs(t, store.DefinitionsInFile("scope", "new.ts"), []string{"add", "move"})
	if got := store.DefinitionsInFile("scope", "new.ts")[1].Source.File; got != "new.ts" {
		t.Fatalf("unrelated delta or returned mutation altered definition index: %q", got)
	}
	assertDefinitionIDs(t, store.DefinitionsInFile("scope", "keep.ts"), []string{"keep"})
}

func TestDefinitionsInFileReplacesBucketsOnFullSnapshot(t *testing.T) {
	store := NewStore()
	firstGeneration := uint64(1)
	store.ApplySnapshot("scope", Snapshot{
		Generation: &firstGeneration,
		Definitions: []api.ProjectDefinition{
			{ID: "move", Source: &api.SourceLoc{File: "old.ts", Line: 1}},
			{ID: "remove", Source: &api.SourceLoc{File: "old.ts", Line: 2}},
		},
	})

	secondGeneration := uint64(2)
	store.ApplySnapshot("scope", Snapshot{
		Generation: &secondGeneration,
		Definitions: []api.ProjectDefinition{
			{ID: "move", Source: &api.SourceLoc{File: "new.ts", Line: 3}},
		},
	})

	if old := store.DefinitionsInFile("scope", "old.ts"); old != nil {
		t.Fatalf("replacement snapshot retained old file bucket: %#v", old)
	}
	assertDefinitionIDs(t, store.DefinitionsInFile("scope", "new.ts"), []string{"move"})
	if _, ok := store.Definition("scope", "remove"); ok {
		t.Fatal("replacement snapshot retained removed definition by ID")
	}
}

func assertDefinitionIDs(t *testing.T, definitions []api.ProjectDefinition, want []string) {
	t.Helper()
	got := make([]string, len(definitions))
	for index, definition := range definitions {
		got[index] = definition.ID
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("definition IDs = %v, want %v", got, want)
	}
}
