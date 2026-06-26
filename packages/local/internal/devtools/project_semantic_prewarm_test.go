package devtools

import (
	"context"
	"errors"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"slices"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestReindexProjectPrewarmsSemanticDuringAstWork(t *testing.T) {
	root := t.TempDir()
	indexer := &prewarmSemanticProjectIndexer{
		root:             root,
		prewarmStarted:   make(chan struct{}),
		prewarmCompleted: make(chan struct{}),
		expectPrewarm:    true,
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	index, err := service.ReindexProjectWithOptions(context.Background(), root, "", "project", ProjectReindexOptions{
		Semantic: ProjectSemanticInline,
	})
	close(indexer.prewarmCompleted)
	if err != nil {
		t.Fatalf("ReindexProjectWithOptions error = %v", err)
	}
	if !indexer.astObservedPrewarm {
		t.Fatal("AST work completed before semantic prewarm started")
	}
	if !indexer.calledSemantic {
		t.Fatal("semantic patch indexer was not called")
	}
	if index.Indexing == nil || index.Indexing.Semantic.Status != "ready" {
		t.Fatalf("indexing = %+v, want ready semantic status", index.Indexing)
	}
}

func TestReindexProjectDoesNotPrewarmSemanticWhenDisabled(t *testing.T) {
	root := t.TempDir()
	indexer := &prewarmSemanticProjectIndexer{
		root:             root,
		prewarmStarted:   make(chan struct{}),
		prewarmCompleted: make(chan struct{}),
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	if _, err := service.ReindexProjectWithOptions(context.Background(), root, "", "project", ProjectReindexOptions{
		Semantic: ProjectSemanticDisabled,
	}); err != nil {
		t.Fatalf("ReindexProjectWithOptions error = %v", err)
	}
	select {
	case <-indexer.prewarmStarted:
		t.Fatal("semantic prewarm started for disabled semantic mode")
	default:
	}
}

func TestReindexProjectRunsPlannedSemanticDuringAstWork(t *testing.T) {
	root := t.TempDir()
	indexer := &earlySemanticProjectIndexer{
		root:            root,
		semanticStarted: make(chan struct{}),
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	index, err := service.ReindexProjectWithOptions(context.Background(), root, "", "project", ProjectReindexOptions{
		Semantic: ProjectSemanticInline,
	})
	if err != nil {
		t.Fatalf("ReindexProjectWithOptions error = %v", err)
	}
	if !indexer.astObservedSemanticStarted {
		t.Fatal("AST work completed before planned semantic work started")
	}
	if indexer.semanticSawPreviousIndex {
		t.Fatal("planned semantic request received previous AST index, want evidence-first request")
	}
	definition := findDefinition(index.Definitions, "prompt:writer")
	if definition == nil || definition.Description != "semantic" {
		t.Fatalf("definitions = %+v, want semantic enrichment applied", index.Definitions)
	}
	if index.SourceGraph == nil || !slices.Contains(index.SourceGraph.Capabilities, "source-dependencies") {
		t.Fatalf("sourceGraph = %+v, want AST sourceGraph joined into semantic patch", index.SourceGraph)
	}
	helper := findSource(index.Sources, root+"/src/helper.ts")
	if helper == nil || !slices.Contains(helper.Dependents, root+"/src/writer.ts") {
		t.Fatalf("sources = %+v, want semantic support source row for helper", index.Sources)
	}
}

func TestReindexProjectDiscardsPlannedSemanticWhenSourceProfileDiffers(t *testing.T) {
	root := t.TempDir()
	indexer := &mismatchedFullPlannedSemanticProjectIndexer{
		root:            root,
		semanticStarted: make(chan struct{}),
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	index, err := service.ReindexProjectWithOptions(context.Background(), root, "", "project", ProjectReindexOptions{
		Semantic: ProjectSemanticInline,
	})
	if err != nil {
		t.Fatalf("ReindexProjectWithOptions error = %v", err)
	}
	if indexer.semanticCalls != 2 {
		t.Fatalf("semantic calls = %d, want early call plus post-AST fallback", indexer.semanticCalls)
	}
	definition := findDefinition(index.Definitions, "prompt:writer")
	if definition == nil || definition.Description != "fallback" {
		t.Fatalf("definitions = %+v, want post-AST fallback semantic result", index.Definitions)
	}
}

type prewarmSemanticProjectIndexer struct {
	root               string
	prewarmStarted     chan struct{}
	prewarmCompleted   chan struct{}
	expectPrewarm      bool
	astObservedPrewarm bool
	calledSemantic     bool
}

type earlySemanticProjectIndexer struct {
	root                       string
	semanticStarted            chan struct{}
	astObservedSemanticStarted bool
	semanticSawPreviousIndex   bool
}

type mismatchedFullPlannedSemanticProjectIndexer struct {
	root            string
	semanticStarted chan struct{}
	semanticCalls   int
}

func (i *earlySemanticProjectIndexer) PlanProjectSemanticRequest(_ context.Context, root, configPath, projectName string) (projectindex.ProjectSemanticIndexRequest, error) {
	return projectindex.ProjectSemanticIndexRequest{
		Root:        root,
		ConfigPath:  configPath,
		ProjectName: projectName,
		Files:       []string{root + "/src/writer.ts"},
		DependencyClosure: []string{
			root + "/src/helper.ts",
			root + "/src/writer.ts",
		},
		SourceProfile: &projectindex.SemanticSourceProfile{
			Complete: true,
			Files: []projectindex.SemanticSourceProfileFile{
				{File: root + "/src/writer.ts", SourceHash: "writer", SourceBytes: 10, Hints: &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{"prompt"}}},
				{File: root + "/src/helper.ts", SourceHash: "helper", SourceBytes: 10, Hints: &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{}}},
			},
			DependencyClosure: []string{
				root + "/src/helper.ts",
				root + "/src/writer.ts",
			},
			SourceBytes: 20,
		},
	}, nil
}

func (i *earlySemanticProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	select {
	case <-i.semanticStarted:
		i.astObservedSemanticStarted = true
	case <-time.After(time.Second):
		return projectindex.IndexPatch{}, errors.New("planned semantic work did not start before AST finished")
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseAST,
		Project:       store.ProjectIdentity{Root: i.root, Name: "project"},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Source:   &store.SourceLoc{File: i.root + "/src/writer.ts"},
				Fidelity: "partial",
				Status:   "active",
			}},
			Sources: []store.IndexSourceFile{{
				File:          i.root + "/src/writer.ts",
				Status:        "indexed",
				DefinitionIDs: []string{"prompt:writer"},
				Dependencies:  []string{i.root + "/src/helper.ts"},
			}, {
				File:       i.root + "/src/helper.ts",
				Status:     "indexed",
				Dependents: []string{i.root + "/src/writer.ts"},
			}},
			SourceGraph: &store.ProjectIndexSourceGraph{
				SchemaVersion: 1,
				ProducedBy:    "@use-crux/indexer",
				Capabilities:  []string{"source-dependencies"},
			},
		},
		SemanticSourceProfile: &projectindex.SemanticSourceProfile{
			Complete: true,
			Files: []projectindex.SemanticSourceProfileFile{
				{File: i.root + "/src/writer.ts", SourceHash: "writer", SourceBytes: 10, Hints: &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{"prompt"}}},
				{File: i.root + "/src/helper.ts", SourceHash: "helper", SourceBytes: 10, Hints: &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{}}},
			},
			DependencyClosure: []string{
				i.root + "/src/helper.ts",
				i.root + "/src/writer.ts",
			},
			SourceBytes: 20,
		},
	}, nil
}

func (i *earlySemanticProjectIndexer) IndexProjectSemanticPatch(_ context.Context, req projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	i.semanticSawPreviousIndex = req.PreviousIndex != nil
	close(i.semanticStarted)
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseSemantic,
		Project:       store.ProjectIdentity{Root: req.Root, Name: req.ProjectName, ConfigFile: req.ConfigPath},
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
			SourceRefs: []projectindex.IndexSourceRefFact{{
				DefinitionID: "prompt:writer",
				Ref: store.ProjectSourceRef{
					ID:     "prompt:writer:source:schema",
					Role:   "schema",
					Source: store.SourceLoc{File: req.Root + "/src/helper.ts"},
					Symbol: "schema",
				},
			}},
		},
	}, nil
}

func (i *mismatchedFullPlannedSemanticProjectIndexer) PlanProjectSemanticRequest(_ context.Context, root, configPath, projectName string) (projectindex.ProjectSemanticIndexRequest, error) {
	return projectindex.ProjectSemanticIndexRequest{
		Root:              root,
		ConfigPath:        configPath,
		ProjectName:       projectName,
		Files:             []string{root + "/src/writer.ts"},
		DependencyClosure: []string{root + "/src/writer.ts"},
		SourceProfile: &projectindex.SemanticSourceProfile{
			Complete: true,
			Files: []projectindex.SemanticSourceProfileFile{{
				File:        root + "/src/writer.ts",
				SourceHash:  "stale",
				SourceBytes: 10,
				Hints:       &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{"prompt"}},
			}},
			DependencyClosure: []string{root + "/src/writer.ts"},
			SourceBytes:       10,
		},
	}, nil
}

func (i *mismatchedFullPlannedSemanticProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	select {
	case <-i.semanticStarted:
	case <-time.After(time.Second):
		return projectindex.IndexPatch{}, errors.New("planned semantic work did not start before AST finished")
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseAST,
		Project:       store.ProjectIdentity{Root: i.root, Name: "project"},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Source:   &store.SourceLoc{File: i.root + "/src/writer.ts"},
				Fidelity: "partial",
				Status:   "active",
			}},
			Sources: []store.IndexSourceFile{{
				File:          i.root + "/src/writer.ts",
				Status:        "indexed",
				DefinitionIDs: []string{"prompt:writer"},
			}},
			SourceGraph: &store.ProjectIndexSourceGraph{
				SchemaVersion: 1,
				ProducedBy:    "@use-crux/indexer",
				Capabilities:  []string{"source-dependencies"},
			},
		},
		SemanticSourceProfile: &projectindex.SemanticSourceProfile{
			Complete: true,
			Files: []projectindex.SemanticSourceProfileFile{{
				File:        i.root + "/src/writer.ts",
				SourceHash:  "fresh",
				SourceBytes: 10,
				Hints:       &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{"prompt"}},
			}},
			DependencyClosure: []string{i.root + "/src/writer.ts"},
			SourceBytes:       10,
		},
	}, nil
}

func (i *mismatchedFullPlannedSemanticProjectIndexer) IndexProjectSemanticPatch(_ context.Context, req projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	i.semanticCalls++
	if i.semanticCalls == 1 {
		close(i.semanticStarted)
		return plannedFullSemanticPatch(req, "early"), nil
	}
	return plannedFullSemanticPatch(req, "fallback"), nil
}

func plannedFullSemanticPatch(req projectindex.ProjectSemanticIndexRequest, description string) projectindex.IndexPatch {
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseSemantic,
		Project:       store.ProjectIdentity{Root: req.Root, Name: req.ProjectName, ConfigFile: req.ConfigPath},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:          "prompt:writer",
				Kind:        "prompt",
				Name:        "writer",
				Description: description,
				Fidelity:    "resolved",
				Status:      "active",
			}},
		},
	}
}

func findSource(sources []store.IndexSourceFile, file string) *store.IndexSourceFile {
	for index := range sources {
		if sources[index].File == file {
			return &sources[index]
		}
	}
	return nil
}

func (i *prewarmSemanticProjectIndexer) PrewarmProjectSemantic(ctx context.Context) error {
	close(i.prewarmStarted)
	select {
	case <-i.prewarmCompleted:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (i *prewarmSemanticProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	if i.expectPrewarm {
		select {
		case <-i.prewarmStarted:
			i.astObservedPrewarm = true
		case <-time.After(time.Second):
			return projectindex.IndexPatch{}, errors.New("semantic prewarm did not start before AST finished")
		}
	}
	return indexPatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: i.root, Name: "project"},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:ast", Kind: "prompt", Name: "ast", Fidelity: "partial", Status: "active"},
		},
	}, projectindex.PhaseAST, "ok"), nil
}

func (i *prewarmSemanticProjectIndexer) IndexProjectSemanticPatch(_ context.Context, req projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	i.calledSemantic = true
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseSemantic,
		Project:       store.ProjectIdentity{Root: req.Root, Name: req.ProjectName, ConfigFile: req.ConfigPath},
		Status:        "ok",
		Facts:         projectindex.IndexPatchFacts{},
	}, nil
}
