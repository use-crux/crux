package projectindex

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestJoinSemanticPatchCarriesSourceGraphAndSupportSources(t *testing.T) {
	graph := &store.ProjectIndexSourceGraph{Capabilities: []string{"source-dependencies"}}
	patch := JoinSemanticPatch(IndexPatch{
		Phase: PhaseSemantic,
		Facts: IndexPatchFacts{
			SourceRefs: []IndexSourceRefFact{{
				DefinitionID: "prompt:writer",
				Ref: store.ProjectSourceRef{
					ID:     "ref:helper",
					Source: store.SourceLoc{File: "src/helper.ts"},
				},
			}},
		},
	}, store.IndexData{
		SourceGraph: graph,
		Definitions: []store.ProjectDefinition{{
			ID:     "prompt:writer",
			Source: &store.SourceLoc{File: "src/writer.ts"},
		}},
	})

	if patch.Facts.SourceGraph != graph {
		t.Fatal("semantic patch did not inherit AST source graph")
	}
	writer := findSourceFile(patch.Facts.Sources, "src/writer.ts")
	helper := findSourceFile(patch.Facts.Sources, "src/helper.ts")
	if writer == nil || helper == nil {
		t.Fatalf("support sources = %+v, want writer and helper rows", patch.Facts.Sources)
	}
	if len(writer.Dependencies) != 1 || writer.Dependencies[0] != "src/helper.ts" {
		t.Fatalf("writer dependencies = %+v, want helper", writer.Dependencies)
	}
	if len(helper.Dependents) != 1 || helper.Dependents[0] != "src/writer.ts" {
		t.Fatalf("helper dependents = %+v, want writer", helper.Dependents)
	}
}

func findSourceFile(sources []store.IndexSourceFile, file string) *store.IndexSourceFile {
	for i := range sources {
		if sources[i].File == file {
			return &sources[i]
		}
	}
	return nil
}
