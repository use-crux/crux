package projectindex

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// ProjectIndexer owns source discovery for the Project Index.
type ProjectIndexer interface {
	IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string) (IndexPatch, error)
}

// DeploymentManifestProjectionInput is the privacy-sensitive compiler snapshot
// forwarded to the TypeScript-authoritative deployment-manifest projector.
type DeploymentManifestProjectionInput struct {
	Root            string
	ProjectID       string
	Definitions     []store.ProjectDefinition
	Relations       []store.ProjectRelation
	StaticFrontend  string
	SemanticBackend string
	SemanticStatus  string
}

// ProjectAstIndexResult is the per-run AST/source indexing result. Optional
// metadata here is carried into later phases instead of reading mutable worker
// diagnostics such as "last timing" state.
type ProjectAstIndexResult struct {
	Patch              IndexPatch
	UsedStaticIndex    bool
	ConfigDependencies []string
}

// ProjectAstResultIndexer optionally returns AST/source patch metadata together
// with the patch. Indexers that do not implement it keep the legacy
// ProjectIndexer behavior and report no Static Index run metadata.
type ProjectAstResultIndexer interface {
	IndexProjectAstPatchWithResult(ctx context.Context, root, configPath, projectName string) (ProjectAstIndexResult, error)
}

// ProjectSemanticIndexRequest describes one semantic Project Index enrichment
// request after AST/source indexing has selected the relevant project scope.
type ProjectSemanticIndexRequest struct {
	Root               string
	ConfigPath         string
	ProjectName        string
	IndexGeneration    uint64
	WatchRunID         uint64
	Budget             IndexPatchBudget
	PreviousIndex      *store.IndexData
	ASTUsedStaticIndex bool
	Files              []string
	DependencyClosure  []string
	SourceProfile      *SemanticSourceProfile
}

type ProjectSemanticIndexer interface {
	IndexProjectSemanticPatch(ctx context.Context, req ProjectSemanticIndexRequest) (IndexPatch, error)
}

// ProjectSemanticPlanner may provide a semantic request before AST indexing
// finishes. The service treats it as an optimization only: planning failures
// fall back to the normal post-AST semantic request.
type ProjectSemanticPlanner interface {
	PlanProjectSemanticRequest(ctx context.Context, root, configPath, projectName string) (ProjectSemanticIndexRequest, error)
}

// ProjectRuntimeIndexRequest describes an explicit runtime-rich indexing pass.
// It receives the already-applied source/semantic snapshot as immutable input
// and must return only runtime-phase evidence.
type ProjectRuntimeIndexRequest struct {
	Root          string
	ConfigPath    string
	ProjectName   string
	Budget        IndexPatchBudget
	PreviousIndex store.IndexData
}

// ProjectRuntimeIndexer owns explicit runtime-rich evidence collection.
type ProjectRuntimeIndexer interface {
	IndexProjectRuntimePatch(ctx context.Context, req ProjectRuntimeIndexRequest) (IndexPatch, error)
}

// ProjectLintIndexRequest asks an indexer to recompute backend-owned lint
// findings over the already-applied Project Index snapshot.
type ProjectLintIndexRequest struct {
	Root               string
	ConfigPath         string
	ProjectName        string
	Budget             IndexPatchBudget
	PreviousIndex      store.IndexData
	Prefetch           *ProjectLintPrefetchResult
	ASTUsedStaticIndex bool
}

// ProjectLintIndexer owns post-merge Project Index lint evaluation.
type ProjectLintIndexer interface {
	IndexProjectLintPatch(ctx context.Context, req ProjectLintIndexRequest) (IndexPatch, error)
}

// ProjectLintPrefetchResult carries backend-specific lint inputs that can be
// computed from an immutable AST graph before the final quality-phase lint
// request sees semantic enrichment.
type ProjectLintPrefetchResult struct {
	RuleFacts []json.RawMessage
}

// ProjectLintPrefetchIndexer optionally computes lint inputs early so semantic
// enrichment and extension rule execution can overlap without changing the
// final post-merge lint contract.
type ProjectLintPrefetchIndexer interface {
	PrefetchProjectLintFacts(ctx context.Context, req ProjectLintIndexRequest) (ProjectLintPrefetchResult, error)
}

type ProjectIncrementalIndexer interface {
	IndexProjectIncremental(ctx context.Context, root, configPath, projectName string, previousIndex store.IndexData, files []string, deletedFiles []string, mode string) (ProjectIndexIncrementalResult, error)
}
