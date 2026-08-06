package service

import (
	"context"
	"encoding/json"

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

// EvalDiscoveryCapacity coordinates Eval discovery with compiler work that
// would otherwise occupy the full semantic worker pool.
type EvalDiscoveryCapacity interface {
	AcquireEvalDiscoveryCapacity(ctx context.Context) (release func(), err error)
}

// ContendedCompilerCapacity coordinates other CPU-heavy compiler work with
// Eval discovery after full-pool semantic demand has been observed.
type ContendedCompilerCapacity interface {
	AcquireContendedCompilerCapacity(ctx context.Context) (release func(), err error)
	EvalDiscoveryIsolationRequired() bool
	PrepareEvalDiscoveryIsolation(request projectindex.ProjectSemanticIndexRequest)
}

// RuntimeClient owns explicit runtime-rich Project Index enrichment.
type RuntimeClient interface {
	projectindex.ProjectRuntimeIndexer
}

// RuntimeOperationClient executes Runtime Engine operator/devtools commands.
type RuntimeOperationClient interface {
	RunRuntimeOperation(ctx context.Context, root, operation, workID string, includeDetails bool) (json.RawMessage, error)
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
