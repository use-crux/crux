package devtools

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestReindexProjectRunsLintPatchAfterSemanticMerge(t *testing.T) {
	indexer := &semanticAwareLintProjectIndexer{}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)

	index, err := service.ReindexProject(context.Background(), "/repo", "crux.config.ts", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if indexer.lintCalls != 1 {
		t.Fatalf("lint calls = %d, want 1", indexer.lintCalls)
	}
	if !indexer.sawSemanticQuality {
		t.Fatal("lint request did not include semantic quality data")
	}
	if findTestLintFinding(index.LintFindings, "lint:quality.missing_baseline:prompt:writer") == nil {
		t.Fatalf("lint findings = %+v, want semantic-aware quality lint", index.LintFindings)
	}
}

func TestReindexProjectInlinePrefetchesLintFactsWhileSemanticRuns(t *testing.T) {
	indexer := &concurrentLintProjectIndexer{
		semanticStarted: make(chan struct{}),
		releaseSemantic: make(chan struct{}),
		prefetchStarted: make(chan struct{}),
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)

	done := make(chan error, 1)
	go func() {
		_, err := service.ReindexProject(context.Background(), "/repo", "crux.config.ts", "project")
		done <- err
	}()

	waitClosed(t, indexer.semanticStarted, "semantic worker did not start")
	waitClosed(t, indexer.prefetchStarted, "lint prefetch did not start while semantic was blocked")
	close(indexer.releaseSemantic)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ReindexProject error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("ReindexProject did not finish")
	}
	if !indexer.sawSemanticQuality {
		t.Fatal("lint request did not include semantic quality data")
	}
	if !indexer.sawPrefetchedRuleFacts {
		t.Fatal("lint request did not include prefetched rule facts")
	}
}

type semanticAwareLintProjectIndexer struct {
	lintCalls          int
	sawSemanticQuality bool
}

func (i *semanticAwareLintProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (IndexPatch, error) {
	return IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseAST,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Status:   "active",
			}},
		},
	}, nil
}

func (i *semanticAwareLintProjectIndexer) IndexProjectSemanticPatch(context.Context, ProjectSemanticIndexRequest) (IndexPatch, error) {
	return IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseSemantic,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Status:   "active",
				Quality: &store.IndexQuality{
					ExperimentIDs:   []string{"experiment:writer"},
					ExperimentCount: 1,
				},
			}},
		},
	}, nil
}

func (i *semanticAwareLintProjectIndexer) IndexProjectLintPatch(_ context.Context, req ProjectLintIndexRequest) (IndexPatch, error) {
	i.lintCalls++
	for _, definition := range req.PreviousIndex.Definitions {
		if definition.ID == "prompt:writer" && definition.Quality != nil && len(definition.Quality.ExperimentIDs) == 1 {
			i.sawSemanticQuality = true
		}
	}
	return IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseQuality,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: IndexPatchFacts{
			LintFindings: []store.IndexLintFinding{{
				ID:         "lint:quality.missing_baseline:prompt:writer",
				RuleID:     "quality.missing_baseline",
				Severity:   "info",
				Category:   "quality",
				Maturity:   "preview",
				Confidence: "high",
				Profiles:   []string{"recommended"},
				Title:      "Quality target has no baseline",
				Message:    "writer has experiment history but no promoted baseline.",
				Evidence:   []store.IndexLintEvidence{},
				Fixes:      []store.IndexLintFix{},
			}},
		},
	}, nil
}

type concurrentLintProjectIndexer struct {
	semanticStarted        chan struct{}
	releaseSemantic        chan struct{}
	prefetchStarted        chan struct{}
	sawSemanticQuality     bool
	sawPrefetchedRuleFacts bool
}

func (i *concurrentLintProjectIndexer) IndexProjectAstPatch(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (IndexPatch, error) {
	_, _, _, _ = ctx, root, configPath, projectName
	return IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseAST,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Status:   "active",
			}},
		},
	}, nil
}

func (i *concurrentLintProjectIndexer) IndexProjectSemanticPatch(ctx context.Context, _ ProjectSemanticIndexRequest) (IndexPatch, error) {
	close(i.semanticStarted)
	select {
	case <-i.releaseSemantic:
	case <-ctx.Done():
		return IndexPatch{}, ctx.Err()
	}
	return IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseSemantic,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Status:   "active",
				Quality: &store.IndexQuality{
					ExperimentIDs:   []string{"experiment:writer"},
					ExperimentCount: 1,
				},
			}},
		},
	}, nil
}

func (i *concurrentLintProjectIndexer) PrefetchProjectLintFacts(_ context.Context, _ ProjectLintIndexRequest) (ProjectLintPrefetchResult, error) {
	close(i.prefetchStarted)
	return ProjectLintPrefetchResult{
		RuleFacts: []json.RawMessage{json.RawMessage(`{"ruleResults":[{"ruleId":"extension.rule"}]}`)},
	}, nil
}

func (i *concurrentLintProjectIndexer) IndexProjectLintPatch(_ context.Context, req ProjectLintIndexRequest) (IndexPatch, error) {
	for _, definition := range req.PreviousIndex.Definitions {
		if definition.ID == "prompt:writer" && definition.Quality != nil {
			i.sawSemanticQuality = true
		}
	}
	i.sawPrefetchedRuleFacts = req.Prefetch != nil && len(req.Prefetch.RuleFacts) == 1
	return IndexPatch{}, nil
}
