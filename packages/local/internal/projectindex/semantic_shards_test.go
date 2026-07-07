package projectindex

import (
	"slices"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectSemanticShardRequestsTrimClosureAndPreviousIndex(t *testing.T) {
	root := "/repo"
	app := root + "/packages/app/src/app.ts"
	helper := root + "/packages/app/src/helper.ts"
	lib := root + "/packages/lib/src/lib.ts"

	shards := ProjectSemanticShardRequests(ProjectSemanticIndexRequest{
		Root:              root,
		Files:             []string{app, lib},
		DependencyClosure: []string{app, helper, lib},
		PreviousIndex: &store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:app", Source: &store.SourceLoc{File: app}},
				{ID: "context:helper", Source: &store.SourceLoc{File: helper}},
				{ID: "prompt:lib", Source: &store.SourceLoc{File: lib}},
				{ID: "project:global", Kind: "workspace"},
			},
			SourceGraph: &store.ProjectIndexSourceGraph{
				SchemaVersion: 1,
				ProducedBy:    "@use-crux/indexer",
				Capabilities:  []string{"source-dependencies", "project-shards"},
				Shards: []store.ProjectIndexShard{
					{ID: "packages/app", Root: root + "/packages/app"},
					{ID: "packages/lib", Root: root + "/packages/lib"},
				},
			},
			Sources: []store.IndexSourceFile{
				{File: app, Status: "indexed", ShardID: "packages/app", Dependencies: []string{helper}},
				{File: helper, Status: "indexed", ShardID: "packages/app"},
				{File: lib, Status: "indexed", ShardID: "packages/lib"},
			},
		},
		SourceProfile: &SemanticSourceProfile{
			Files: []SemanticSourceProfileFile{
				{File: app, SourceHash: "hash-app", SourceBytes: 10},
				{File: helper, SourceHash: "hash-helper", SourceBytes: 12},
				{File: lib, SourceHash: "hash-lib", SourceBytes: 14},
			},
			DependencyClosure: []string{app, helper, lib},
			SourceBytes:       36,
			Complete:          true,
		},
	})

	if len(shards) != 2 {
		t.Fatalf("semantic shards = %d, want 2", len(shards))
	}
	appShard := shards[0]
	if appShard.ShardID != "packages/app" {
		t.Fatalf("first shard ID = %q, want packages/app", appShard.ShardID)
	}
	assertStrings(t, appShard.Request.Files, []string{app})
	assertStrings(t, appShard.Request.DependencyClosure, []string{app, helper})
	assertDefinitionIDs(t, appShard.Request.PreviousIndex.Definitions, []string{"context:helper", "project:global", "prompt:app"})
	assertProfileFiles(t, appShard.Request.SourceProfile, []string{app, helper})
	if appShard.Request.SourceProfile.SourceBytes != 22 {
		t.Fatalf("app shard source bytes = %d, want 22", appShard.Request.SourceProfile.SourceBytes)
	}

	libShard := shards[1]
	if libShard.ShardID != "packages/lib" {
		t.Fatalf("second shard ID = %q, want packages/lib", libShard.ShardID)
	}
	assertStrings(t, libShard.Request.Files, []string{lib})
	assertStrings(t, libShard.Request.DependencyClosure, []string{lib})
	assertDefinitionIDs(t, libShard.Request.PreviousIndex.Definitions, []string{"project:global", "prompt:lib"})
	assertProfileFiles(t, libShard.Request.SourceProfile, []string{lib})
}

func TestMergeSemanticPatchesDoesNotInvalidateExistingASTFacts(t *testing.T) {
	merged, err := MergeSemanticPatches([]IndexPatch{
		{
			SchemaVersion: 1,
			Phase:         PhaseSemantic,
			Project:       store.ProjectIdentity{Root: "/repo"},
			StartedAt:     "2026-07-07T00:00:00Z",
			FinishedAt:    "2026-07-07T00:00:01Z",
			Status:        "ok",
			Facts: IndexPatchFacts{
				Definitions: []store.ProjectDefinition{{ID: "prompt:app", Description: "app"}},
			},
		},
		{
			SchemaVersion: 1,
			Phase:         PhaseSemantic,
			Project:       store.ProjectIdentity{Root: "/repo"},
			StartedAt:     "2026-07-07T00:00:00Z",
			FinishedAt:    "2026-07-07T00:00:02Z",
			Status:        "ok",
			Facts: IndexPatchFacts{
				Definitions: []store.ProjectDefinition{{ID: "prompt:lib", Description: "lib"}},
			},
		},
	})
	if err != nil {
		t.Fatalf("MergeSemanticPatches error = %v", err)
	}
	if merged.Invalidates != nil {
		t.Fatalf("merged semantic patch invalidates = %+v, want nil", merged.Invalidates)
	}
	assertDefinitionIDs(t, merged.Facts.Definitions, []string{"prompt:app", "prompt:lib"})
	if merged.FinishedAt != "2026-07-07T00:00:02Z" {
		t.Fatalf("merged finishedAt = %q, want latest shard finish", merged.FinishedAt)
	}
}

func assertStrings(t testing.TB, got []string, want []string) {
	t.Helper()
	if !slices.Equal(got, want) {
		t.Fatalf("strings = %v, want %v", got, want)
	}
}

func assertDefinitionIDs(t testing.TB, definitions []store.ProjectDefinition, want []string) {
	t.Helper()
	got := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		got = append(got, definition.ID)
	}
	slices.Sort(got)
	assertStrings(t, got, want)
}

func assertProfileFiles(t testing.TB, profile *SemanticSourceProfile, want []string) {
	t.Helper()
	if profile == nil {
		t.Fatal("source profile = nil")
	}
	got := make([]string, 0, len(profile.Files))
	for _, file := range profile.Files {
		got = append(got, file.File)
	}
	slices.Sort(got)
	assertStrings(t, got, want)
}
