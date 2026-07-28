package service

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"

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
		SchemaVersion:   1,
		Phase:           projectindex.PhaseSemantic,
		Project:         store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:          "ok",
		SemanticBackend: "native",
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

type watchFallbackIndexer struct {
	calledFull               bool
	calledIncrement          bool
	redactPatternsConfigured bool
}

func (i *watchFallbackIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	i.calledFull = true
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseAST,
		Project: store.ProjectIdentity{
			Root:       "/repo",
			Name:       "project",
			ConfigFile: "crux.config.ts",
			Observability: &store.ProjectObservability{
				RedactPatternsConfigured: i.redactPatternsConfigured,
			},
		},
		Status: "ok",
		Facts: projectindex.IndexPatchFacts{
			Sources: []store.IndexSourceFile{{
				File:          "/repo/src/writer.ts",
				Status:        "indexed",
				ShardID:       ".",
				DefinitionIDs: []string{"prompt:writer"},
			}},
			SourceGraph: &store.ProjectIndexSourceGraph{
				SchemaVersion: 1,
				ProducedBy:    "@use-crux/indexer",
				Capabilities:  []string{"source-dependencies", "source-dependents", "definition-ownership", "diagnostic-ownership", "project-shards"},
				Shards:        []store.ProjectIndexShard{{ID: ".", Root: "/repo"}},
			},
		},
	}, nil
}

func (i *watchFallbackIndexer) IndexProjectIncremental(
	context.Context,
	string,
	string,
	string,
	store.IndexData,
	[]string,
	[]string,
	string,
) (projectindex.ProjectIndexIncrementalResult, error) {
	i.calledIncrement = true
	return projectindex.ProjectIndexIncrementalResult{}, nil
}

type watchBackgroundLintIndexer struct {
	lintStarted chan struct{}
	releaseLint chan struct{}
	lintDone    chan struct{}
}

func (i *watchBackgroundLintIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (i *watchBackgroundLintIndexer) IndexProjectIncremental(
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
			PlanKind:           "source-file-reindex",
			ASTUsedStaticIndex: true,
			GraphConfidence:    "complete-enough-for-source-closure",
			ChangedFiles:       []string{"/repo/src/writer.ts"},
			AffectedFiles:      []string{"/repo/src/writer.ts"},
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
			},
		}},
	}, nil
}

func (i *watchBackgroundLintIndexer) IndexProjectLintPatch(context.Context, projectindex.ProjectLintIndexRequest) (projectindex.IndexPatch, error) {
	close(i.lintStarted)
	<-i.releaseLint
	close(i.lintDone)
	return projectindex.IndexPatch{}, nil
}

type cancellableBackgroundSemanticIndexer struct {
	root string

	mu             sync.Mutex
	semanticCalls  int
	firstStarted   chan struct{}
	firstCanceled  chan struct{}
	secondStarted  chan struct{}
	releaseSecond  chan struct{}
	secondDone     chan struct{}
	firstStartOnce sync.Once
	firstDoneOnce  sync.Once
	secondOnce     sync.Once
	secondDoneOnce sync.Once
}

func newCancellableBackgroundSemanticIndexer(root string) *cancellableBackgroundSemanticIndexer {
	return &cancellableBackgroundSemanticIndexer{
		root:          root,
		firstStarted:  make(chan struct{}),
		firstCanceled: make(chan struct{}),
		secondStarted: make(chan struct{}),
		releaseSecond: make(chan struct{}),
		secondDone:    make(chan struct{}),
	}
}

func (i *cancellableBackgroundSemanticIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (i *cancellableBackgroundSemanticIndexer) IndexProjectIncremental(
	_ context.Context,
	root string,
	configPath string,
	projectName string,
	_ store.IndexData,
	files []string,
	_ []string,
	_ string,
) (projectindex.ProjectIndexIncrementalResult, error) {
	changedFile := ""
	if len(files) > 0 {
		changedFile = files[0]
	}
	return projectindex.ProjectIndexIncrementalResult{
		Report: projectindex.ProjectIndexIncrementalReport{
			PlanKind:        "source-file-reindex",
			GraphConfidence: "complete-enough-for-source-closure",
			ChangedFiles:    []string{changedFile},
			AffectedFiles:   []string{changedFile},
		},
		Patches: []projectindex.IndexPatch{{
			SchemaVersion: 1,
			Phase:         projectindex.PhaseAST,
			Project:       store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath},
			Status:        "ok",
			Invalidates:   &projectindex.IndexPatchInvalidation{Files: []string{changedFile}},
			Facts: projectindex.IndexPatchFacts{
				Sources: []store.IndexSourceFile{{
					File:          changedFile,
					Status:        "indexed",
					ShardID:       ".",
					DefinitionIDs: []string{fmt.Sprintf("prompt:%s", filepath.Base(changedFile))},
				}},
			},
		}},
	}, nil
}

func (i *cancellableBackgroundSemanticIndexer) IndexProjectSemanticPatch(ctx context.Context, req projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	i.mu.Lock()
	i.semanticCalls++
	call := i.semanticCalls
	i.mu.Unlock()

	switch call {
	case 1:
		i.firstStartOnce.Do(func() { close(i.firstStarted) })
		<-ctx.Done()
		i.firstDoneOnce.Do(func() { close(i.firstCanceled) })
		return projectindex.IndexPatch{}, ctx.Err()
	case 2:
		i.secondOnce.Do(func() { close(i.secondStarted) })
		<-i.releaseSecond
		i.secondDoneOnce.Do(func() { close(i.secondDone) })
		return projectindex.IndexPatch{
			SchemaVersion: 1,
			Phase:         projectindex.PhaseSemantic,
			Project:       store.ProjectIdentity{Root: req.Root, Name: req.ProjectName, ConfigFile: req.ConfigPath},
			Status:        "ok",
			Facts:         projectindex.IndexPatchFacts{},
		}, nil
	default:
		return projectindex.IndexPatch{}, fmt.Errorf("unexpected semantic call %d", call)
	}
}

func backgroundSemanticPreviousIndex(root string) store.IndexData {
	sourceA := filepath.Join(root, "src/a.ts")
	sourceB := filepath.Join(root, "src/b.ts")
	return store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project", ConfigFile: "crux.config.ts"},
		SourceGraph: &store.ProjectIndexSourceGraph{
			SchemaVersion: 1,
			ProducedBy:    "@use-crux/indexer",
			Capabilities:  []string{"source-dependencies", "source-dependents", "definition-ownership", "diagnostic-ownership", "project-shards"},
			Shards:        []store.ProjectIndexShard{{ID: ".", Root: root}},
		},
		Sources: []store.IndexSourceFile{
			{File: sourceA, Status: "indexed", ShardID: ".", DefinitionIDs: []string{"prompt:a"}},
			{File: sourceB, Status: "indexed", ShardID: ".", DefinitionIDs: []string{"prompt:b"}},
		},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:a", Kind: "prompt", Name: "a", Source: &store.SourceLoc{File: sourceA}, Fidelity: "partial", Status: "active"},
			{ID: "prompt:b", Kind: "prompt", Name: "b", Source: &store.SourceLoc{File: sourceB}, Fidelity: "partial", Status: "active"},
		},
	}
}
