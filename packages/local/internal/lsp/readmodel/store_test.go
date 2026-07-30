package readmodel

import (
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestStoreAppliesSnapshotsPerScopeAndAnchor(t *testing.T) {
	store := NewStore()
	generation := uint64(4)
	changed := store.ApplySnapshot("scope-a", Snapshot{
		Generation: &generation,
		Findings: []api.IndexLintFinding{
			finding("file-a", "/repo/a.ts"),
			finding("project", ""),
		},
	})

	assertStrings(t, changed, []string{"", "/repo/a.ts"})
	assertFindingIDs(t, store.Findings("scope-a", "/repo/a.ts"), []string{"file-a"})
	assertFindingIDs(t, store.Findings("scope-a", ""), []string{"project"})
	assertFindingIDs(t, store.Findings("scope-b", "/repo/a.ts"), nil)

	changed = store.ApplySnapshot("scope-a", Snapshot{Generation: &generation, Findings: []api.IndexLintFinding{}})
	assertStrings(t, changed, []string{"", "/repo/a.ts"})
	assertFindingIDs(t, store.Findings("scope-a", "/repo/a.ts"), nil)
}

func TestStoreFindingReturnsDetachedCopyByID(t *testing.T) {
	store := NewStore()
	store.ApplySnapshot("scope", Snapshot{Findings: []api.IndexLintFinding{{
		ID: "finding", Source: &api.SourceLoc{File: "a.ts"},
		Fixes: []api.IndexLintFix{{Title: "Original"}},
	}}})

	finding, ok := store.Finding("scope", "finding")
	if !ok {
		t.Fatal("finding was not found")
	}
	finding.Fixes[0].Title = "Mutated"
	again, ok := store.Finding("scope", "finding")
	if !ok || again.Fixes[0].Title != "Original" {
		t.Fatalf("stored finding changed through returned copy: %#v", again)
	}
	if _, ok := store.Finding("scope", "missing"); ok {
		t.Fatal("missing finding was reported as present")
	}
}

func TestStoreAppliesReplacementDeltasAndPreservesOmittedLints(t *testing.T) {
	store := NewStore()
	generation := uint64(8)
	store.ApplySnapshot("scope", Snapshot{
		Generation: &generation,
		Findings:   []api.IndexLintFinding{finding("old", "/repo/a.ts")},
	})

	result := store.ApplyDelta("scope", Delta{
		Generation: 8,
		File:       "/repo/a.ts",
		Lints:      &LintReplacement{Findings: []api.IndexLintFinding{finding("new", "/repo/a.ts")}},
	})
	if result.Status != DeltaApplied {
		t.Fatalf("same-generation delta status = %v, want applied", result.Status)
	}
	assertStrings(t, result.ChangedFiles, []string{"/repo/a.ts"})
	assertFindingIDs(t, store.Findings("scope", "/repo/a.ts"), []string{"new"})

	result = store.ApplyDelta("scope", Delta{Generation: 9, File: "/repo/a.ts"})
	if result.Status != DeltaApplied || len(result.ChangedFiles) != 0 {
		t.Fatalf("omitted lints result = %#v, want applied without changes", result)
	}
	assertFindingIDs(t, store.Findings("scope", "/repo/a.ts"), []string{"new"})

	result = store.ApplyDelta("scope", Delta{
		Generation: 9,
		File:       "/repo/a.ts",
		Lints:      &LintReplacement{Findings: []api.IndexLintFinding{}},
	})
	if result.Status != DeltaApplied {
		t.Fatalf("clear delta status = %v, want applied", result.Status)
	}
	assertFindingIDs(t, store.Findings("scope", "/repo/a.ts"), nil)
}

func TestStoreReportsSourceOnlyDeltaForLineCacheInvalidation(t *testing.T) {
	store := NewStore()
	generation := uint64(1)
	store.ApplySnapshot("scope", Snapshot{Generation: &generation})

	result := store.ApplyDelta("scope", Delta{
		Generation:    2,
		File:          "/repo/source.ts",
		SourceChanged: true,
	})
	if result.Status != DeltaApplied {
		t.Fatalf("source-only delta status = %v, want applied", result.Status)
	}
	assertStrings(t, result.ChangedFiles, []string{"/repo/source.ts"})
}

func TestStoreAppliesDiagnosticAndSourceRowReplacements(t *testing.T) {
	t.Parallel()

	const file = "/repo/source.ts"
	generation := uint64(1)
	store := NewStore()
	store.ApplySnapshot("scope", Snapshot{
		Generation: &generation,
		Diagnostics: []api.IndexDiagnostic{{
			ID: "diagnostic:old", Source: &api.SourceLoc{File: file, Line: 1},
		}},
		Sources: []api.IndexSourceFile{{File: file, SourceHash: "old-hash"}},
	})

	result := store.ApplyDelta("scope", Delta{
		Generation: 2,
		File:       file,
		Diagnostics: []api.IndexDiagnostic{{
			ID: "diagnostic:new", Source: &api.SourceLoc{File: file, Line: 2},
		}},
		SourceRow:     &api.IndexSourceFile{File: file, SourceHash: "new-hash"},
		SourceChanged: true,
	})
	if result.Status != DeltaApplied {
		t.Fatalf("replacement status = %v, want applied", result.Status)
	}
	assertStrings(t, result.ChangedFiles, []string{file})
	publication := store.PublicationSnapshot("scope")
	if len(publication.Diagnostics[file]) != 1 ||
		publication.Diagnostics[file][0].ID != "diagnostic:new" ||
		publication.SourcesByFile[file].SourceHash != "new-hash" {
		t.Fatalf("replacement publication = %#v", publication)
	}

	result = store.ApplyDelta("scope", Delta{
		Generation:    3,
		File:          file,
		Diagnostics:   []api.IndexDiagnostic{},
		SourceChanged: true,
	})
	if result.Status != DeltaApplied {
		t.Fatalf("clear status = %v, want applied", result.Status)
	}
	publication = store.PublicationSnapshot("scope")
	if len(publication.Diagnostics[file]) != 0 {
		t.Fatalf("diagnostics = %#v, want cleared", publication.Diagnostics[file])
	}
	if _, exists := publication.SourcesByFile[file]; exists {
		t.Fatalf("sources = %#v, want removed row", publication.SourcesByFile)
	}
}

func TestStoreReportsSourceOnlySnapshotChangeForLineCacheInvalidation(t *testing.T) {
	store := NewStore()
	generation := uint64(1)
	store.ApplySnapshot("scope", Snapshot{
		Generation: &generation,
		Sources: []api.IndexSourceFile{{
			File: "/repo/source.ts", SourceHash: "before",
		}},
	})

	changed := store.ApplySnapshot("scope", Snapshot{
		Generation: &generation,
		Sources: []api.IndexSourceFile{{
			File: "/repo/source.ts", SourceHash: "after",
		}},
	})
	assertStrings(t, changed, []string{"/repo/source.ts"})
}

func TestStoreGenerationRules(t *testing.T) {
	store := NewStore()

	beforeSnapshot := store.ApplyDelta("scope", Delta{Generation: 1, File: "a.ts", Lints: &LintReplacement{}})
	if beforeSnapshot.Status != DeltaNeedsResync {
		t.Fatalf("pre-snapshot status = %v, want resync", beforeSnapshot.Status)
	}

	generation := uint64(10)
	store.ApplySnapshot("scope", Snapshot{Generation: &generation, Findings: []api.IndexLintFinding{finding("kept", "a.ts")}})
	older := store.ApplyDelta("scope", Delta{Generation: 9, File: "a.ts", Lints: &LintReplacement{}})
	if older.Status != DeltaIgnored {
		t.Fatalf("older delta status = %v, want ignored", older.Status)
	}

	gap := store.ApplyDelta("scope", Delta{Generation: 12, File: "a.ts", Lints: &LintReplacement{}})
	if gap.Status != DeltaNeedsResync {
		t.Fatalf("gap delta status = %v, want resync", gap.Status)
	}
	assertFindingIDs(t, store.Findings("scope", "a.ts"), []string{"kept"})
}

func TestStoreBootstrapsGenerationForLegacySnapshot(t *testing.T) {
	store := NewStore()
	store.ApplySnapshot("scope", Snapshot{Findings: []api.IndexLintFinding{finding("old", "a.ts")}})

	first := store.ApplyDelta("scope", Delta{
		Generation: 42,
		File:       "a.ts",
		Lints:      &LintReplacement{Findings: []api.IndexLintFinding{finding("current", "a.ts")}},
	})
	if first.Status != DeltaApplied {
		t.Fatalf("legacy bootstrap delta status = %v, want applied", first.Status)
	}

	gap := store.ApplyDelta("scope", Delta{Generation: 44, File: "a.ts", Lints: &LintReplacement{}})
	if gap.Status != DeltaNeedsResync {
		t.Fatalf("post-bootstrap gap status = %v, want resync", gap.Status)
	}
}

func TestStoreRetainsDefinitionRangesAndReportsDefinitionOnlyChanges(t *testing.T) {
	store := NewStore()
	generation := uint64(1)
	store.ApplySnapshot("scope", Snapshot{
		Generation: &generation,
		Definitions: []api.ProjectDefinition{
			{
				ID: "prompt:writer",
				SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
					File: "a.ts", StartLine: 2,
				}},
				SourceRefs: []api.ProjectSourceRef{{
					ID: "ref", Metadata: map[string]any{"roles": []any{"prompt"}},
				}},
			},
		},
	})
	definition, ok := store.Definition("scope", "prompt:writer")
	if !ok || definition.SourceSnippet == nil || definition.SourceSnippet.Range.StartLine != 2 {
		t.Fatalf("snapshot definition = %#v, %v", definition, ok)
	}
	definition.SourceRefs[0].Metadata["roles"].([]any)[0] = "mutated"
	detached, _ := store.Definition("scope", "prompt:writer")
	if got := detached.SourceRefs[0].Metadata["roles"].([]any)[0]; got != "prompt" {
		t.Fatalf("definition metadata was not detached: %v", got)
	}

	result := store.ApplyDelta("scope", Delta{
		Generation: 2,
		File:       "a.ts",
		Definitions: DefinitionChanges{
			Changed: []api.ProjectDefinition{
				{
					ID: "prompt:writer",
					SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
						File: "a.ts", StartLine: 4,
					}},
				},
			},
		},
	})
	if result.Status != DeltaApplied {
		t.Fatalf("definition delta status = %v", result.Status)
	}
	assertStrings(t, result.ChangedFiles, []string{"a.ts"})
	definition, _ = store.Definition("scope", "prompt:writer")
	if definition.SourceSnippet.Range.StartLine != 4 {
		t.Fatalf("changed definition = %#v", definition)
	}
}

func finding(id, file string) api.IndexLintFinding {
	finding := api.IndexLintFinding{ID: id, RuleID: "test.rule"}
	if file != "" {
		finding.Source = &api.SourceLoc{File: file, Line: 1}
	}
	return finding
}

func assertFindingIDs(t *testing.T, findings []api.IndexLintFinding, want []string) {
	t.Helper()
	got := make([]string, 0, len(findings))
	for _, finding := range findings {
		got = append(got, finding.ID)
	}
	if !reflect.DeepEqual(got, want) && !(len(got) == 0 && len(want) == 0) {
		t.Fatalf("finding IDs = %v, want %v", got, want)
	}
}

func assertStrings(t *testing.T, got, want []string) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("values = %v, want %v", got, want)
	}
}
