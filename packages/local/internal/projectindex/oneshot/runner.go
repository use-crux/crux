// Package oneshot composes one bounded, daemon-free Project Index refresh.
//
// The runner deliberately delegates AST discovery, semantic enrichment, cache
// handling, and lint evaluation to the same service and worker clients used by
// the local daemon. It owns process lifetime only; callers own presentation.
package oneshot

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/service"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// Options identifies the project compiled by a one-shot refresh.
type Options struct {
	// Root is the project directory. Relative roots are resolved before indexing.
	Root string
	// ConfigPath is an optional absolute or root-relative Crux config path.
	ConfigPath string
	// ProjectID scopes Project Index cache/display identity for this invocation.
	ProjectID string
}

// Result is the canonical Project Index snapshot plus stable execution state.
type Result struct {
	Index     store.IndexData
	Execution Execution
}

// Runner owns composition of the existing Project Index service pipeline.
type Runner struct {
	indexer   projectindex.ProjectIndexer
	factStore service.CacheStore
}

// New creates a runner around explicit phase clients, primarily for hosts and
// parity tests. The caller retains ownership of indexer lifecycle.
func New(indexer projectindex.ProjectIndexer, factStore service.CacheStore) *Runner {
	return &Runner{indexer: indexer, factStore: factStore}
}

// Run performs one inline semantic Project Index refresh and returns only after
// post-merge lint evaluation has completed.
func (r *Runner) Run(ctx context.Context, options Options) (Result, error) {
	if r == nil || r.indexer == nil {
		return Result{}, fmt.Errorf("one-shot Project Index runner is not configured")
	}
	root, err := absoluteProjectRoot(options.Root)
	if err != nil {
		return Result{}, err
	}

	indexStore := store.NewStore()
	indexService := service.New(service.Options{
		Context:   ctx,
		Store:     indexStore,
		Indexer:   r.indexer,
		FactStore: r.factStore,
	})
	index, err := indexService.ReindexProjectWithOptions(
		ctx,
		root,
		options.ConfigPath,
		options.ProjectID,
		service.ProjectReindexOptions{Semantic: service.ProjectSemanticInline},
	)
	if err != nil {
		return Result{}, err
	}
	return Result{Index: index, Execution: executionFromIndex(index)}, nil
}

func absoluteProjectRoot(root string) (string, error) {
	if root == "" {
		root = "."
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve project root: %w", err)
	}
	return filepath.Clean(absolute), nil
}
