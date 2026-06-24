package devtools

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"slices"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectSemanticIndexRequestFiltersRootsWithSourceProfileHints(t *testing.T) {
	root := t.TempDir()
	writer := root + "/src/writer.ts"
	helper := root + "/src/helper.ts"
	shared := root + "/src/shared.ts"

	req := projectSemanticIndexRequest(root, "", "project", store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		Sources: []store.IndexSourceFile{
			{File: writer, Status: "indexed", Dependencies: []string{shared}},
			{File: helper, Status: "indexed"},
			{File: shared, Status: "indexed"},
		},
		SourceGraph: &store.ProjectIndexSourceGraph{
			SchemaVersion: 1,
			ProducedBy:    "@crux/indexer",
			Capabilities:  []string{"source-dependencies"},
		},
	}, nil, &projectindex.SemanticSourceProfile{
		Files: []projectindex.SemanticSourceProfileFile{
			{
				File:        writer,
				SourceHash:  "hash-writer",
				SourceBytes: 12,
				Hints:       &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{"prompt"}},
			},
			{
				File:        helper,
				SourceHash:  "hash-helper",
				SourceBytes: 14,
				Hints:       &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{}},
			},
			{
				File:        shared,
				SourceHash:  "hash-shared",
				SourceBytes: 16,
				Hints:       &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{}},
			},
		},
		SourceBytes: 42,
		Complete:    true,
	})

	assertStringSlicesEqual(t, req.Files, []string{writer})
	assertStringSlicesEqual(t, req.DependencyClosure, []string{shared, writer})
	if req.SourceProfile == nil {
		t.Fatalf("source profile = nil, want trimmed profile")
	}
	assertStringSlicesEqual(t, semanticProfileFiles(req.SourceProfile), []string{shared, writer})
	if req.SourceProfile.SourceBytes != 28 {
		t.Fatalf("source profile bytes = %d, want 28", req.SourceProfile.SourceBytes)
	}
	if !req.SourceProfile.Complete {
		t.Fatalf("source profile complete = false, want true")
	}
}

func TestProjectSemanticIndexRequestUsesCompleteSourceProfileClosure(t *testing.T) {
	root := t.TempDir()
	writer := root + "/src/writer.ts"
	shared := root + "/src/shared.ts"
	extra := root + "/src/extra.ts"

	req := projectSemanticIndexRequest(root, "", "project", store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		Sources: []store.IndexSourceFile{
			{File: writer, Status: "indexed", Dependencies: []string{shared}},
			{File: shared, Status: "indexed"},
			{File: extra, Status: "indexed"},
		},
		SourceGraph: &store.ProjectIndexSourceGraph{
			SchemaVersion: 1,
			ProducedBy:    "@crux/indexer",
			Capabilities:  []string{"source-dependencies"},
		},
	}, nil, &projectindex.SemanticSourceProfile{
		Files: []projectindex.SemanticSourceProfileFile{
			{
				File:        writer,
				SourceHash:  "hash-writer",
				SourceBytes: 12,
				Hints:       &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{"prompt"}},
			},
			{
				File:        shared,
				SourceHash:  "hash-shared",
				SourceBytes: 16,
				Hints:       &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{}},
			},
			{
				File:        extra,
				SourceHash:  "hash-extra",
				SourceBytes: 18,
				Hints:       &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{}},
			},
		},
		DependencyClosure: []string{extra, shared, writer},
		SourceBytes:       46,
		Complete:          true,
	})

	assertStringSlicesEqual(t, req.Files, []string{writer})
	assertStringSlicesEqual(t, req.DependencyClosure, []string{extra, shared, writer})
	if req.SourceProfile == nil {
		t.Fatalf("source profile = nil, want profile")
	}
	assertStringSlicesEqual(t, semanticProfileFiles(req.SourceProfile), []string{extra, shared, writer})
}

func TestProjectSemanticIndexRequestPrunesPreviousIndexToSemanticClosure(t *testing.T) {
	root := t.TempDir()
	writer := root + "/src/writer.ts"
	shared := root + "/src/shared.ts"
	unrelated := root + "/src/unrelated.ts"

	req := projectSemanticIndexRequest(root, "", "project", store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:writer", Kind: "prompt", Name: "writer", Source: &store.SourceLoc{File: writer}},
			{ID: "context:shared", Kind: "context", Name: "shared", Source: &store.SourceLoc{File: shared}},
			{ID: "prompt:unrelated", Kind: "prompt", Name: "unrelated", Source: &store.SourceLoc{File: unrelated}},
			{ID: "project:global", Kind: "workspace", Name: "global"},
		},
		Sources: []store.IndexSourceFile{
			{File: writer, Status: "indexed", Dependencies: []string{shared}},
			{File: shared, Status: "indexed"},
			{File: unrelated, Status: "indexed"},
		},
		SourceGraph: &store.ProjectIndexSourceGraph{
			SchemaVersion: 1,
			ProducedBy:    "@crux/indexer",
			Capabilities:  []string{"source-dependencies"},
		},
	}, []string{writer}, nil)

	assertStringSlicesEqual(t, req.Files, []string{writer})
	assertStringSlicesEqual(t, req.DependencyClosure, []string{shared, writer})
	if req.PreviousIndex == nil {
		t.Fatalf("previous index = nil, want scoped previous index")
	}
	assertDefinitionIDs(t, req.PreviousIndex.Definitions, []string{"context:shared", "project:global", "prompt:writer"})
	assertSourceFiles(t, req.PreviousIndex.Sources, []string{shared, writer})
}

func TestProjectSemanticIndexRequestKeepsExplicitScope(t *testing.T) {
	root := t.TempDir()
	helper := root + "/src/helper.ts"

	req := projectSemanticIndexRequest(root, "", "project", store.IndexData{}, []string{helper}, &projectindex.SemanticSourceProfile{
		Files: []projectindex.SemanticSourceProfileFile{{
			File:        helper,
			SourceHash:  "hash-helper",
			SourceBytes: 14,
			Hints:       &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{}},
		}},
		SourceBytes: 14,
		Complete:    true,
	})

	assertStringSlicesEqual(t, req.Files, []string{helper})
	assertStringSlicesEqual(t, req.DependencyClosure, nil)
	if req.SourceProfile == nil {
		t.Fatalf("source profile = nil, want explicit scope profile")
	}
	assertStringSlicesEqual(t, semanticProfileFiles(req.SourceProfile), []string{helper})
}

func semanticProfileFiles(profile *projectindex.SemanticSourceProfile) []string {
	files := make([]string, 0, len(profile.Files))
	for _, file := range profile.Files {
		files = append(files, file.File)
	}
	slices.Sort(files)
	return files
}

func assertStringSlicesEqual(t testing.TB, got []string, want []string) {
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
	assertStringSlicesEqual(t, got, want)
}

func assertSourceFiles(t testing.TB, sources []store.IndexSourceFile, want []string) {
	t.Helper()
	got := make([]string, 0, len(sources))
	for _, source := range sources {
		got = append(got, source.File)
	}
	slices.Sort(got)
	assertStringSlicesEqual(t, got, want)
}
