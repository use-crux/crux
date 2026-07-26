package view

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestSavedProviderCapturesOneDetachedPublicationPerRequest(t *testing.T) {
	t.Parallel()

	const (
		scope = "scope"
		fileA = "/repo/a.ts"
		fileB = "/repo/b.ts"
	)
	store := readmodel.NewStore()
	generationA := uint64(4)
	store.ApplySnapshot(scope, completeViewSnapshot("a", fileA, &generationA))
	provider := NewSavedProvider(store)

	first := provider.BestAvailableView(ViewRequest{
		ScopeID: scope, MinimumEvidence: EvidenceSemantic, Freshness: RequireCurrent,
	})
	generationB := uint64(5)
	store.ApplySnapshot(scope, completeViewSnapshot("b", fileB, &generationB))
	second := provider.BestAvailableView(ViewRequest{
		ScopeID: scope, MinimumEvidence: EvidenceSemantic, Freshness: RequireCurrent,
	})

	if first.View == nil || second.View == nil {
		t.Fatalf("selections = (%#v, %#v), want two views", first, second)
	}
	assertCompleteView(t, *first.View, "a", fileA, generationA, 1)
	assertCompleteView(t, *second.View, "b", fileB, generationB, 2)
	if _, mixed := first.View.Publication.DefinitionsByID["b"]; mixed {
		t.Fatalf("first publication observed later generation: %#v", first.View.Publication)
	}
	if first.View.Publication.Generation != first.View.Stamp.BaseGeneration ||
		first.View.Publication.GenerationKnown != first.View.Stamp.BaseGenerationKnown ||
		first.View.Publication.Revision != first.View.Stamp.Revision {
		t.Fatalf("duplicate publication identity diverged from stamp: %#v", first.View)
	}
}

func completeViewSnapshot(id, file string, generation *uint64) readmodel.Snapshot {
	column := 1
	return readmodel.Snapshot{
		Generation: generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Diagnostics: []api.IndexDiagnostic{{
			ID: "diagnostic:" + id, Source: &api.SourceLoc{File: file, Line: 1},
		}},
		Findings: []api.IndexLintFinding{{
			ID: "finding:" + id, RuleID: "test.rule",
			Source: &api.SourceLoc{File: file, Line: 1},
		}},
		Definitions: []api.ProjectDefinition{{
			ID: id, Source: &api.SourceLoc{File: file, Line: 1},
			SourceRefs: []api.ProjectSourceRef{{
				ID: "ref:" + id, Source: api.SourceLoc{File: file, Line: 1, Column: &column},
			}},
		}},
		Relations: []api.ProjectRelation{{
			ID: "relation:" + id, To: id,
			Source: &api.SourceLoc{File: file, Line: 1, Column: &column},
		}},
		Sources: []api.IndexSourceFile{{File: file, SourceHash: "hash:" + id}},
	}
}

func assertCompleteView(
	t *testing.T,
	view ProjectIndexView,
	id string,
	file string,
	generation uint64,
	revision uint64,
) {
	t.Helper()

	publication := view.Publication
	if view.Stamp.BaseGeneration != generation || view.Stamp.Revision != revision ||
		publication.DefinitionsByID[id].ID != id ||
		publication.DefinitionsByID[id].SourceRefs[0].ID != "ref:"+id ||
		publication.Relations[0].ID != "relation:"+id ||
		publication.SitesByFile[file][0].TargetDefinitionID != id ||
		publication.Diagnostics[file][0].ID != "diagnostic:"+id ||
		publication.Findings[file][0].ID != "finding:"+id ||
		publication.SourcesByFile[file].SourceHash != "hash:"+id {
		t.Fatalf("view did not retain one complete publication: %#v", view)
	}
}
