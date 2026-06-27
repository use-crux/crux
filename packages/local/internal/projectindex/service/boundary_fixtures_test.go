package service

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// boundaryIndexer is a full-flow fake phase client: source AST, semantic
// enrichment, and a lint phase that records whether it observed the semantic
// index.
type boundaryIndexer struct {
	semanticCalls   int
	lintCalls       int
	lintSawSemantic bool
}

func (i *boundaryIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseAST,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "partial",
				Status:   "active",
			}},
		},
	}, nil
}

func (i *boundaryIndexer) IndexProjectSemanticPatch(context.Context, projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	i.semanticCalls++
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseSemantic,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:          "prompt:writer",
				Kind:        "prompt",
				Name:        "writer",
				Description: "semantic",
				Fidelity:    "resolved",
				Status:      "active",
			}},
		},
	}, nil
}

func (i *boundaryIndexer) IndexProjectLintPatch(_ context.Context, request projectindex.ProjectLintIndexRequest) (projectindex.IndexPatch, error) {
	i.lintCalls++
	i.lintSawSemantic = findBoundaryDefinition(request.PreviousIndex.Definitions, "prompt:writer") != nil
	return projectindex.IndexPatch{}, nil
}

func findBoundaryDefinition(definitions []store.ProjectDefinition, id string) *store.ProjectDefinition {
	for index := range definitions {
		if definitions[index].ID == id {
			return &definitions[index]
		}
	}
	return nil
}

// boundaryIncrementalIndexer is a watch-driven fake that emits a single source
// AST patch without semantic or lint phases.
type boundaryIncrementalIndexer struct{}

func (i *boundaryIncrementalIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (i *boundaryIncrementalIndexer) IndexProjectIncremental(
	context.Context,
	string,
	string,
	string,
	store.IndexData,
	[]string,
	[]string,
	string,
) (projectindex.ProjectIndexIncrementalResult, error) {
	return projectindex.ProjectIndexIncrementalResult{
		Report: projectindex.ProjectIndexIncrementalReport{
			PlanKind:        "source-file-reindex",
			GraphConfidence: "complete-enough-for-source-closure",
			ChangedFiles:    []string{"/repo/src/writer.ts"},
			AffectedFiles:   []string{"/repo/src/writer.ts"},
			DurationMsByPhase: map[string]float64{
				"ast.incremental": 4,
			},
		},
		Patches: []projectindex.IndexPatch{{
			SchemaVersion: 1,
			Phase:         projectindex.PhaseAST,
			Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
			Status:        "ok",
			Invalidates:   &projectindex.IndexPatchInvalidation{Files: []string{"/repo/src/writer.ts"}},
			Facts: projectindex.IndexPatchFacts{
				Definitions: []store.ProjectDefinition{{
					ID:       "prompt:writer",
					Kind:     "prompt",
					Name:     "writer",
					Source:   &store.SourceLoc{File: "/repo/src/writer.ts"},
					Fidelity: "partial",
					Status:   "active",
				}},
				Sources: []store.IndexSourceFile{{
					File:          "/repo/src/writer.ts",
					Status:        "indexed",
					ShardID:       ".",
					DefinitionIDs: []string{"prompt:writer"},
				}},
			},
		}},
	}, nil
}

// boundarySemanticIncrementalIndexer drives the incremental flow through the
// shared semantic + lint completion: it reuses the incremental AST patch and
// adds semantic enrichment plus a lint phase that observes the semantic index.
type boundarySemanticIncrementalIndexer struct {
	boundaryIncrementalIndexer
	semanticCalls   int
	lintCalls       int
	lintSawSemantic bool
}

func (i *boundarySemanticIncrementalIndexer) IndexProjectSemanticPatch(
	context.Context,
	projectindex.ProjectSemanticIndexRequest,
) (projectindex.IndexPatch, error) {
	i.semanticCalls++
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseSemantic,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:          "prompt:writer",
				Kind:        "prompt",
				Name:        "writer",
				Source:      &store.SourceLoc{File: "/repo/src/writer.ts"},
				Description: "semantic",
				Fidelity:    "resolved",
				Status:      "active",
			}},
		},
	}, nil
}

func (i *boundarySemanticIncrementalIndexer) IndexProjectLintPatch(
	_ context.Context,
	request projectindex.ProjectLintIndexRequest,
) (projectindex.IndexPatch, error) {
	i.lintCalls++
	writer := findBoundaryDefinition(request.PreviousIndex.Definitions, "prompt:writer")
	i.lintSawSemantic = writer != nil && writer.Description == "semantic"
	return projectindex.IndexPatch{}, nil
}

func boundaryPreviousIndex() store.IndexData {
	return store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		SourceGraph: &store.ProjectIndexSourceGraph{
			SchemaVersion: 1,
			ProducedBy:    "@use-crux/indexer",
			Capabilities: []string{
				"source-dependencies",
				"source-dependents",
				"definition-ownership",
				"diagnostic-ownership",
				"project-shards",
			},
			Shards: []store.ProjectIndexShard{{ID: ".", Root: "/repo/src"}},
		},
		Definitions: []store.ProjectDefinition{{
			ID:       "prompt:writer",
			Kind:     "prompt",
			Name:     "writer",
			Source:   &store.SourceLoc{File: "/repo/src/writer.ts"},
			Fidelity: "partial",
			Status:   "active",
		}},
		Sources: []store.IndexSourceFile{{
			File:          "/repo/src/writer.ts",
			Status:        "indexed",
			ShardID:       ".",
			DefinitionIDs: []string{"prompt:writer"},
			Dependencies:  []string{},
			Dependents:    []string{},
		}},
	}
}
