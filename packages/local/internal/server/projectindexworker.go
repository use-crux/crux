package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ProjectIndexWorker runs project-indexer.mjs through the V2 NDJSON worker protocol.
type ProjectIndexWorker struct {
	scriptPath     string
	worker         *nodeworker.Worker
	semanticWorker *ProjectSemanticWorker
	runtimeWorker  *ProjectRuntimeWorker
	syntaxWorker   ProjectSyntaxParser
	timingsMu      sync.Mutex
	lastAstTiming  ProjectIndexAstTiming
}

// ProjectIndexAstTiming captures production AST pipeline timings for benchmark
// and architecture work. It is diagnostic metadata only; it is not part of the
// Project Index read model.
type ProjectIndexAstTiming struct {
	PlanMs                  float64
	NativeParseAndForwardMs float64
	NodeProjectionMs        float64
	TotalMs                 float64
	NodeTimings             []devtools.ProjectIndexPhaseTiming
	RecordCount             int
	RecordBytes             int
	ChunkCount              int
	MaxChunkBytes           int
}

type projectIndexRequest struct {
	ProtocolVersion          int                                  `json:"protocolVersion,omitempty"`
	Method                   string                               `json:"method"`
	RequestID                string                               `json:"requestId,omitempty"`
	RequestKind              string                               `json:"requestKind,omitempty"`
	Root                     string                               `json:"root"`
	ConfigPath               string                               `json:"configPath,omitempty"`
	ProjectName              string                               `json:"projectName,omitempty"`
	ResolutionMode           string                               `json:"resolutionMode,omitempty"`
	SemanticBudget           *devtools.IndexPatchBudget           `json:"semanticBudget,omitempty"`
	PreviousIndex            *store.IndexData                     `json:"previousIndex,omitempty"`
	PreviousDefinitions      []store.ProjectDefinition            `json:"previousIndexDefinitions,omitempty"`
	PreviousSources          []store.IndexSourceFile              `json:"previousIndexSources,omitempty"`
	Files                    []string                             `json:"files,omitempty"`
	DeletedFiles             []string                             `json:"deletedFiles,omitempty"`
	SyntaxRecords            []json.RawMessage                    `json:"syntaxRecords,omitempty"`
	SyntaxRecordsBatch       []json.RawMessage                    `json:"syntaxRecordsBatch,omitempty"`
	SyntaxFrontend           *devtools.SyntaxFrontend             `json:"syntaxFrontendIdentity,omitempty"`
	NativeFactProjection     string                               `json:"nativeFactProjection,omitempty"`
	DependencyClosure        []string                             `json:"dependencyClosure,omitempty"`
	SourceProfile            *devtools.SemanticSourceProfile      `json:"sourceProfile,omitempty"`
	SourceProfileFiles       []devtools.SemanticSourceProfileFile `json:"sourceProfileFiles,omitempty"`
	Mode                     string                               `json:"mode,omitempty"`
	MaxAffectedFiles         int                                  `json:"maxAffectedFiles,omitempty"`
	IncludeStaticCacheStatus bool                                 `json:"includeStaticCacheStatus,omitempty"`
	StaticCacheHits          []devtools.StaticCacheHit            `json:"staticCacheHits,omitempty"`
}

const projectIndexWorkerMaxResponseBytes = 16 * 1024 * 1024
const projectIndexWorkerProducer = "@crux/indexer/project-indexer"

// NewProjectIndexWorker creates a worker backed by project-indexer.mjs.
func NewProjectIndexWorker(scriptPath string) *ProjectIndexWorker {
	return &ProjectIndexWorker{
		scriptPath:     scriptPath,
		worker:         newNodeStreamWorker("project-indexer", embeddedProjectIndexer, scriptPath),
		semanticWorker: NewProjectSemanticWorker(""),
		runtimeWorker:  NewProjectRuntimeWorker(""),
		syntaxWorker:   projectSyntaxWorkerFromEnv(),
	}
}

// LastAstTiming returns timing metadata from the most recent AST index run.
func (w *ProjectIndexWorker) LastAstTiming() ProjectIndexAstTiming {
	if w == nil {
		return ProjectIndexAstTiming{}
	}
	w.timingsMu.Lock()
	defer w.timingsMu.Unlock()
	return w.lastAstTiming
}

func (w *ProjectIndexWorker) recordLastAstTiming(timing ProjectIndexAstTiming) {
	if w == nil {
		return
	}
	w.timingsMu.Lock()
	defer w.timingsMu.Unlock()
	w.lastAstTiming = timing
}

// ResolveProjectModel returns the JSON-safe source-discovery Project Model for root.
// Config policy may be imported, but authored source modules are not executed;
// richer runtime evidence is supplied by the dev server's staged indexing path.
func (w *ProjectIndexWorker) ResolveProjectModel(ctx context.Context, root, configPath, projectName string) (json.RawMessage, error) {
	req := projectIndexRequest{
		Method:         "resolveProjectModel",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "config-policy",
	}
	return w.streamArtifact(ctx, req, devtools.ProjectIndexArtifactProjectModel)
}

// InspectProjectConfig returns the JSON-safe effective Crux configuration for
// root: every config() domain with resolved values and origin tags. Unlike
// ResolveProjectModel it imports the project's config (in inert CRUX_INDEX=1
// mode) so explicit overrides — not just defaults — are reflected.
func (w *ProjectIndexWorker) InspectProjectConfig(ctx context.Context, root, configPath, projectName string) (json.RawMessage, error) {
	req := projectIndexRequest{
		Method:         "inspectProjectConfig",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "config-policy",
	}
	resp, err := w.streamArtifact(ctx, req, devtools.ProjectIndexArtifactProjectConfig)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, err
		}
		resp, err = w.sourceOnlyArtifactFallback(ctx, req, devtools.ProjectIndexArtifactProjectConfig, err)
		if err != nil {
			return nil, err
		}
	}
	return resp, nil
}

func (w *ProjectIndexWorker) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string) (devtools.IndexPatch, error) {
	if w.syntaxWorker != nil {
		return w.indexProjectAstPatchFromNativeSyntaxRecords(ctx, root, configPath, projectName)
	}
	return w.indexProjectAstPatchFromTypeScript(ctx, root, configPath, projectName)
}

func (w *ProjectIndexWorker) indexProjectAstPatchFromTypeScript(ctx context.Context, root, configPath, projectName string) (devtools.IndexPatch, error) {
	started := time.Now()
	req := projectIndexRequest{
		Method:         "indexProjectAst",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "source-only",
	}
	collector, err := w.streamCollector(ctx, req, devtools.IndexPatchBudget{})
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	patches, err := collector.Patches()
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	if len(patches) != 1 {
		return devtools.IndexPatch{}, fmt.Errorf("project ast worker returned %d patches, want 1", len(patches))
	}
	w.recordLastAstTiming(ProjectIndexAstTiming{TotalMs: elapsedMs(started), NodeTimings: collector.Timings()})
	return patches[0], nil
}

func (w *ProjectIndexWorker) IndexProjectSemanticPatch(ctx context.Context, request devtools.ProjectSemanticIndexRequest) (devtools.IndexPatch, error) {
	if w.semanticWorker == nil {
		return devtools.IndexPatch{}, fmt.Errorf("project semantic worker is not configured")
	}
	return w.semanticWorker.IndexProjectSemanticPatch(ctx, request)
}

func (w *ProjectIndexWorker) IndexProjectRuntimePatch(ctx context.Context, request devtools.ProjectRuntimeIndexRequest) (devtools.IndexPatch, error) {
	if w.runtimeWorker == nil {
		return devtools.IndexPatch{}, fmt.Errorf("project runtime worker is not configured")
	}
	return w.runtimeWorker.IndexProjectRuntimePatch(ctx, request)
}

func (w *ProjectIndexWorker) IndexProjectIncremental(ctx context.Context, root, configPath, projectName string, previousIndex store.IndexData, files []string, deletedFiles []string, mode string) (devtools.ProjectIndexIncrementalResult, error) {
	if mode == "" {
		mode = "ast"
	}
	req := projectIndexRequest{
		Method:        "indexProjectIncremental",
		Root:          root,
		ConfigPath:    configPath,
		ProjectName:   projectName,
		PreviousIndex: &previousIndex,
		Files:         files,
		DeletedFiles:  deletedFiles,
		Mode:          mode,
	}
	collector, err := w.streamCollector(ctx, req, devtools.IndexPatchBudget{})
	if err != nil {
		return devtools.ProjectIndexIncrementalResult{}, err
	}
	return collector.IncrementalResult()
}

// Close shuts down the worker process.
func (w *ProjectIndexWorker) Close() error {
	var closeErr error
	if w.worker != nil {
		if err := w.worker.Close(); err != nil {
			closeErr = err
		}
	}
	if w.semanticWorker != nil {
		if err := w.semanticWorker.Close(); err != nil {
			closeErr = err
		}
	}
	if w.runtimeWorker != nil {
		if err := w.runtimeWorker.Close(); err != nil {
			closeErr = err
		}
	}
	if w.syntaxWorker != nil {
		if err := w.syntaxWorker.Close(); err != nil {
			closeErr = err
		}
	}
	return closeErr
}
