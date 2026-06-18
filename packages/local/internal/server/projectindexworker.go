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
	scriptPath string
}

type projectIndexRequest struct {
	ProtocolVersion  int                        `json:"protocolVersion,omitempty"`
	Method           string                     `json:"method"`
	Root             string                     `json:"root"`
	ConfigPath       string                     `json:"configPath,omitempty"`
	ProjectName      string                     `json:"projectName,omitempty"`
	ResolutionMode   string                     `json:"resolutionMode,omitempty"`
	SemanticBudget   *devtools.IndexPatchBudget `json:"semanticBudget,omitempty"`
	PreviousIndex    *store.IndexData           `json:"previousIndex,omitempty"`
	Files            []string                   `json:"files,omitempty"`
	DeletedFiles     []string                   `json:"deletedFiles,omitempty"`
	Mode             string                     `json:"mode,omitempty"`
	MaxAffectedFiles int                        `json:"maxAffectedFiles,omitempty"`
}

const projectIndexStaticFallbackTimeout = 30 * time.Second
const projectIndexWorkerMaxResponseBytes = 16 * 1024 * 1024
const projectIndexWorkerProducer = "@crux/indexer/project-indexer"

// NewProjectIndexWorker creates a worker backed by project-indexer.mjs.
func NewProjectIndexWorker(scriptPath string) *ProjectIndexWorker {
	return &ProjectIndexWorker{scriptPath: scriptPath}
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

func (w *ProjectIndexWorker) IndexProjectSemanticPatch(ctx context.Context, root, configPath, projectName string, budget devtools.IndexPatchBudget) (devtools.IndexPatch, error) {
	req := projectIndexRequest{
		Method:         "indexProjectSemantic",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		SemanticBudget: &budget,
	}
	patches, err := w.streamPatches(ctx, req, budget)
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	if len(patches) != 1 {
		return devtools.IndexPatch{}, fmt.Errorf("project semantic worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}

func (w *ProjectIndexWorker) IndexProjectIncremental(ctx context.Context, root, configPath, projectName string, previousIndex store.IndexData, files []string, deletedFiles []string, mode string) (devtools.ProjectIndexIncrementalResult, error) {
	if mode == "" {
		mode = "ast-and-semantic"
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
	return nil
}
