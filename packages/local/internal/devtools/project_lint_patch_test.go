package devtools

import (
	"context"
	"encoding/json"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
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
	if !indexer.sawSemanticRuns {
		t.Fatal("lint request did not include semantic run data")
	}
	if findTestLintFinding(index.LintFindings, "lint:definition.missing_eval_coverage:prompt:writer") == nil {
		t.Fatalf("lint findings = %+v, want semantic-aware lint", index.LintFindings)
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
	if !indexer.sawSemanticRuns {
		t.Fatal("lint request did not include semantic run data")
	}
	if !indexer.sawPrefetchedRuleFacts {
		t.Fatal("lint request did not include prefetched rule facts")
	}
}

type semanticAwareLintProjectIndexer struct {
	lintCalls       int
	sawSemanticRuns bool
}

func (i *semanticAwareLintProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
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
				Fidelity: "resolved",
				Status:   "active",
			}},
		},
	}, nil
}

func (i *semanticAwareLintProjectIndexer) IndexProjectSemanticPatch(context.Context, projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseSemantic,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Status:   "active",
				Quality: &store.IndexQuality{
					RunIDs:   []string{"experiment:writer"},
					RunCount: 1,
				},
			}},
		},
	}, nil
}

func (i *semanticAwareLintProjectIndexer) IndexProjectLintPatch(_ context.Context, req projectindex.ProjectLintIndexRequest) (projectindex.IndexPatch, error) {
	i.lintCalls++
	for _, definition := range req.PreviousIndex.Definitions {
		if definition.ID == "prompt:writer" && definition.Quality != nil && len(definition.Quality.RunIDs) == 1 {
			i.sawSemanticRuns = true
		}
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseQuality,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			LintFindings: []store.IndexLintFinding{{
				ID:         "lint:definition.missing_eval_coverage:prompt:writer",
				RuleID:     "definition.missing_eval_coverage",
				Severity:   "info",
				Category:   "evaluation",
				Maturity:   "preview",
				Confidence: "high",
				Profiles:   []string{"recommended"},
				Title:      "Definition has no Eval coverage",
				Message:    "writer has no associated Eval coverage.",
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
	sawSemanticRuns        bool
	sawPrefetchedRuleFacts bool
}

func (i *concurrentLintProjectIndexer) IndexProjectAstPatch(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (projectindex.IndexPatch, error) {
	_, _, _, _ = ctx, root, configPath, projectName
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
				Fidelity: "resolved",
				Status:   "active",
			}},
		},
	}, nil
}

func (i *concurrentLintProjectIndexer) IndexProjectSemanticPatch(ctx context.Context, _ projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	close(i.semanticStarted)
	select {
	case <-i.releaseSemantic:
	case <-ctx.Done():
		return projectindex.IndexPatch{}, ctx.Err()
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseSemantic,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Status:   "active",
				Quality: &store.IndexQuality{
					RunIDs:   []string{"experiment:writer"},
					RunCount: 1,
				},
			}},
		},
	}, nil
}

func (i *concurrentLintProjectIndexer) PrefetchProjectLintFacts(_ context.Context, _ projectindex.ProjectLintIndexRequest) (projectindex.ProjectLintPrefetchResult, error) {
	close(i.prefetchStarted)
	return projectindex.ProjectLintPrefetchResult{
		RuleFacts: []json.RawMessage{json.RawMessage(`{"ruleResults":[{"ruleId":"extension.rule"}]}`)},
	}, nil
}

func (i *concurrentLintProjectIndexer) IndexProjectLintPatch(_ context.Context, req projectindex.ProjectLintIndexRequest) (projectindex.IndexPatch, error) {
	for _, definition := range req.PreviousIndex.Definitions {
		if definition.ID == "prompt:writer" && definition.Quality != nil {
			i.sawSemanticRuns = true
		}
	}
	i.sawPrefetchedRuleFacts = req.Prefetch != nil && len(req.Prefetch.RuleFacts) == 1
	return projectindex.IndexPatch{}, nil
}
