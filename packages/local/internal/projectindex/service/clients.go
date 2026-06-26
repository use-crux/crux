package service

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/cache"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ASTClient owns source/static Project Index discovery.
type ASTClient interface {
	projectindex.ProjectIndexer
}

// ASTResultClient can return static execution metadata with the AST patch.
type ASTResultClient interface {
	projectindex.ProjectAstResultIndexer
}

// SemanticClient owns semantic Project Index enrichment.
type SemanticClient interface {
	projectindex.ProjectSemanticIndexer
}

// SemanticPlanner can prepare a semantic request before AST indexing finishes.
type SemanticPlanner interface {
	projectindex.ProjectSemanticPlanner
}

// SemanticPrewarmer can start semantic backend setup before a request is ready.
type SemanticPrewarmer interface {
	PrewarmProjectSemantic(ctx context.Context) error
}

// RuntimeClient owns explicit runtime-rich Project Index enrichment.
type RuntimeClient interface {
	projectindex.ProjectRuntimeIndexer
}

// LintClient owns post-merge Project Index lint evaluation.
type LintClient interface {
	projectindex.ProjectLintIndexer
}

// LintPrefetchClient computes immutable lint inputs that can overlap semantic work.
type LintPrefetchClient interface {
	projectindex.ProjectLintPrefetchIndexer
}

// IncrementalClient owns watch-driven incremental AST patching.
type IncrementalClient interface {
	projectindex.ProjectIncrementalIndexer
}

// SnapshotStore is the mutable Project Index snapshot store used by scheduling.
type SnapshotStore interface {
	GetIndex() store.IndexData
	SetIndexData(store.IndexData)
}

// CacheStore persists phase transactions used for Project Index warm starts.
type CacheStore interface {
	cache.FactStore
}
