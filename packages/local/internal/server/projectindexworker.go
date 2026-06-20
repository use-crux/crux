package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
}

type projectIndexRequest struct {
	ProtocolVersion     int                                  `json:"protocolVersion,omitempty"`
	Method              string                               `json:"method"`
	RequestID           string                               `json:"requestId,omitempty"`
	RequestKind         string                               `json:"requestKind,omitempty"`
	Root                string                               `json:"root"`
	ConfigPath          string                               `json:"configPath,omitempty"`
	ProjectName         string                               `json:"projectName,omitempty"`
	ResolutionMode      string                               `json:"resolutionMode,omitempty"`
	SemanticBudget      *devtools.IndexPatchBudget           `json:"semanticBudget,omitempty"`
	PreviousIndex       *store.IndexData                     `json:"previousIndex,omitempty"`
	PreviousDefinitions []store.ProjectDefinition            `json:"previousIndexDefinitions,omitempty"`
	PreviousSources     []store.IndexSourceFile              `json:"previousIndexSources,omitempty"`
	Files               []string                             `json:"files,omitempty"`
	DeletedFiles        []string                             `json:"deletedFiles,omitempty"`
	DependencyClosure   []string                             `json:"dependencyClosure,omitempty"`
	SourceProfile       *devtools.SemanticSourceProfile      `json:"sourceProfile,omitempty"`
	SourceProfileFiles  []devtools.SemanticSourceProfileFile `json:"sourceProfileFiles,omitempty"`
	Mode                string                               `json:"mode,omitempty"`
	MaxAffectedFiles    int                                  `json:"maxAffectedFiles,omitempty"`
}

const projectIndexStaticFallbackTimeout = 30 * time.Second
const projectIndexWorkerMaxResponseBytes = 16 * 1024 * 1024
const projectIndexWorkerProducer = "@crux/indexer/project-indexer"

// NewProjectIndexWorker creates a worker backed by project-indexer.mjs.
func NewProjectIndexWorker(scriptPath string) *ProjectIndexWorker {
	return &ProjectIndexWorker{
		scriptPath:     scriptPath,
		worker:         newNodeStreamWorker("project-indexer", embeddedProjectIndexer, scriptPath),
		semanticWorker: NewProjectSemanticWorker(""),
	}
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
	req := projectIndexRequest{
		Method:         "indexProjectAst",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "source-only",
	}
	patches, err := w.streamPatches(ctx, req, devtools.IndexPatchBudget{})
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	if len(patches) != 1 {
		return devtools.IndexPatch{}, fmt.Errorf("project ast worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}

func (w *ProjectIndexWorker) IndexProjectSemanticPatch(ctx context.Context, request devtools.ProjectSemanticIndexRequest) (devtools.IndexPatch, error) {
	if w.semanticWorker == nil {
		return devtools.IndexPatch{}, fmt.Errorf("project semantic worker is not configured")
	}
	return w.semanticWorker.IndexProjectSemanticPatch(ctx, request)
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

func (w *ProjectIndexWorker) sourceOnlyArtifactFallback(ctx context.Context, req projectIndexRequest, artifact devtools.ProjectIndexArtifactKind, cause error) (json.RawMessage, error) {
	timeout := projectIndexStaticFallbackTimeout
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining < 0 {
			remaining = 0
		}
		if remaining < timeout {
			timeout = remaining
		}
	}

	fallbackCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req.ResolutionMode = "source-only"
	resp, err := w.streamArtifact(fallbackCtx, req, artifact)
	if err != nil {
		return nil, fmt.Errorf("project index source-only fallback after worker failure (%s): %w", cause.Error(), err)
	}
	return resp, nil
}

func (w *ProjectIndexWorker) streamPatches(ctx context.Context, req projectIndexRequest, budget devtools.IndexPatchBudget) ([]devtools.IndexPatch, error) {
	collector, err := w.streamCollector(ctx, req, budget)
	if err != nil {
		return nil, err
	}
	return collector.Patches()
}

func (w *ProjectIndexWorker) streamCollector(ctx context.Context, req projectIndexRequest, budget devtools.IndexPatchBudget) (*devtools.ProjectIndexPatchStreamCollector, error) {
	collector := devtools.NewProjectIndexPatchStreamCollector(devtools.ProjectIndexPatchStreamOptions{
		Root:             req.Root,
		Budget:           budget,
		MaxBytes:         projectIndexWorkerMaxResponseBytes,
		MaxFactsPerBatch: projectIndexWorkerMaxFactsPerBatch(req.Method),
		Producer:         projectIndexWorkerProducer,
	})
	err := w.streamPatchRequest(ctx, req, collector.Handle, func() bool {
		if req.Method == "indexProjectIncremental" {
			return collector.HasIncrementalReport()
		}
		return collector.CompletedPatchCount() >= 1
	})
	if err != nil {
		return nil, err
	}
	return collector, nil
}

func (w *ProjectIndexWorker) streamArtifact(ctx context.Context, req projectIndexRequest, artifact devtools.ProjectIndexArtifactKind) (json.RawMessage, error) {
	collector := devtools.NewProjectIndexArtifactStreamCollector(devtools.ProjectIndexArtifactStreamOptions{
		Root:     req.Root,
		Artifact: artifact,
		MaxBytes: projectIndexWorkerMaxResponseBytes,
	})
	result, err := w.streamRequest(ctx, req, collector.Handle)
	if err != nil {
		return nil, err
	}
	if result.ExitErr != nil {
		if result.Stderr != "" {
			return nil, fmt.Errorf("project index worker exited: %w: %s", result.ExitErr, result.Stderr)
		}
		return nil, fmt.Errorf("project index worker exited: %w", result.ExitErr)
	}
	return collector.Payload()
}

func (w *ProjectIndexWorker) streamRequest(ctx context.Context, req projectIndexRequest, handle func(json.RawMessage) error) (nodeworker.StreamResult, error) {
	req.ProtocolVersion = 2
	data, err := json.Marshal(req)
	if err != nil {
		return nodeworker.StreamResult{}, fmt.Errorf("marshal streamed project index request: %w", err)
	}
	data = append(data, '\n')
	return nodeworker.Stream(ctx, nodeworker.OneShot{
		Script: nodeworker.Script{
			Name:    "project-indexer",
			Content: embeddedProjectIndexer,
		},
		ScriptPath:   w.scriptPath,
		Input:        data,
		MaxLineBytes: projectIndexWorkerMaxResponseBytes,
	}, handle)
}

func (w *ProjectIndexWorker) streamPatchRequest(ctx context.Context, req projectIndexRequest, handle func(json.RawMessage) error, done func() bool) error {
	req.ProtocolVersion = 2
	requests := projectIndexWorkerRequestBatch(req)
	return nodeworker.StreamCallBatch(ctx, w.worker, requests, func(raw json.RawMessage) (bool, error) {
		if err := handle(raw); err != nil {
			return false, err
		}
		return done(), nil
	})
}

func projectIndexWorkerRequestBatch(req projectIndexRequest) []any {
	if !shouldChunkProjectIndexRequest(req) {
		return []any{req}
	}
	requestID := fmt.Sprintf("index:%d", time.Now().UnixNano())
	events := []any{projectIndexWorkerStartRequest(req, requestID)}
	events = appendProjectIndexPreviousIndexBatches(events, req, requestID)
	events = append(events, projectIndexRequest{
		ProtocolVersion: 2,
		Method:          req.Method,
		RequestID:       requestID,
		RequestKind:     "done",
	})
	return events
}

func shouldChunkProjectIndexRequest(req projectIndexRequest) bool {
	return req.Method == "indexProjectIncremental" &&
		req.PreviousIndex != nil &&
		(len(req.PreviousIndex.Definitions) > 0 || len(req.PreviousIndex.Sources) > 0)
}

func projectIndexWorkerStartRequest(req projectIndexRequest, requestID string) projectIndexRequest {
	start := req
	start.RequestID = requestID
	start.RequestKind = "start"
	start.PreviousDefinitions = nil
	start.PreviousSources = nil
	if start.PreviousIndex != nil {
		previous := *start.PreviousIndex
		previous.Definitions = nil
		previous.Sources = nil
		start.PreviousIndex = &previous
	}
	return start
}

func appendProjectIndexPreviousIndexBatches(events []any, req projectIndexRequest, requestID string) []any {
	if req.PreviousIndex == nil {
		return events
	}
	for _, batch := range projectDefinitionBatches(req.PreviousIndex.Definitions, projectIndexWorkerRequestBatchSize) {
		events = append(events, projectIndexRequest{
			ProtocolVersion:     2,
			Method:              req.Method,
			RequestID:           requestID,
			RequestKind:         "previousIndex:definitions",
			PreviousDefinitions: batch,
		})
	}
	for _, batch := range indexSourceFileBatches(req.PreviousIndex.Sources, projectIndexWorkerRequestBatchSize) {
		events = append(events, projectIndexRequest{
			ProtocolVersion: 2,
			Method:          req.Method,
			RequestID:       requestID,
			RequestKind:     "previousIndex:sources",
			PreviousSources: batch,
		})
	}
	return events
}

const projectIndexWorkerRequestBatchSize = 128

func projectIndexWorkerMaxFactsPerBatch(method string) int {
	switch method {
	case "indexProjectSemantic":
		return 100
	case "indexProjectAst", "indexProjectIncremental":
		return 200
	default:
		return 100
	}
}

// Close shuts down the worker process.
func (w *ProjectIndexWorker) Close() error {
	if w.worker != nil {
		if err := w.worker.Close(); err != nil {
			return err
		}
	}
	if w.semanticWorker != nil {
		return w.semanticWorker.Close()
	}
	return nil
}
