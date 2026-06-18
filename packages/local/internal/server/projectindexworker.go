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

// ProjectIndexWorker manages a lazy Node.js subprocess for Project Index indexing.
type ProjectIndexWorker struct {
	worker *nodeworker.Worker
}

type projectIndexRequest struct {
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

// NewProjectIndexWorker creates a worker backed by project-indexer.mjs.
func NewProjectIndexWorker(scriptPath string) *ProjectIndexWorker {
	opts := []nodeworker.Option{nodeworker.WithMaxResponseBytes(projectIndexWorkerMaxResponseBytes)}
	if scriptPath != "" {
		opts = append(opts, nodeworker.WithScriptPath(scriptPath))
	}
	return &ProjectIndexWorker{
		worker: nodeworker.New(nodeworker.Script{
			Name:    "project-indexer",
			Content: embeddedProjectIndexer,
		}, opts...),
	}
}

// IndexProject returns a canonical Project Index snapshot for root.
func (w *ProjectIndexWorker) IndexProject(ctx context.Context, root, configPath, projectName string) (store.IndexData, error) {
	req := projectIndexRequest{
		Method:         "indexProject",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "runtime-rich",
	}
	resp, err := w.call(ctx, req)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return store.IndexData{}, err
		}
		resp, err = w.sourceOnlyFallback(ctx, req, err)
		if err != nil {
			return store.IndexData{}, err
		}
	}

	var result struct {
		Snapshot store.IndexData `json:"snapshot"`
		Error    string          `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return store.IndexData{}, fmt.Errorf("unmarshal project index response: %w", err)
	}
	if result.Error != "" {
		return store.IndexData{}, fmt.Errorf("project index worker: %s", result.Error)
	}
	return result.Snapshot, nil
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
	resp, err := w.call(ctx, req)
	if err != nil {
		return nil, err
	}

	var result struct {
		ProjectModel json.RawMessage `json:"projectModel"`
		Error        string          `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("unmarshal project model response: %w", err)
	}
	if result.Error != "" {
		return nil, fmt.Errorf("project model worker: %s", result.Error)
	}
	if len(result.ProjectModel) == 0 {
		return nil, fmt.Errorf("project model worker response missing projectModel field")
	}
	return result.ProjectModel, nil
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
	resp, err := w.call(ctx, req)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, err
		}
		resp, err = w.sourceOnlyFallback(ctx, req, err)
		if err != nil {
			return nil, err
		}
	}

	var result struct {
		Config json.RawMessage `json:"config"`
		Error  string          `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("unmarshal project config response: %w", err)
	}
	if result.Error != "" {
		return nil, fmt.Errorf("project config worker: %s", result.Error)
	}
	if len(result.Config) == 0 {
		return nil, fmt.Errorf("project config worker response missing config field")
	}
	return result.Config, nil
}

func (w *ProjectIndexWorker) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string) (devtools.IndexPatch, error) {
	req := projectIndexRequest{
		Method:         "indexProjectAst",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "source-only",
	}
	resp, err := w.call(ctx, req)
	if err != nil {
		return devtools.IndexPatch{}, err
	}

	var result struct {
		Patch devtools.IndexPatch `json:"patch"`
		Error string              `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return devtools.IndexPatch{}, fmt.Errorf("unmarshal project ast response: %w", err)
	}
	if result.Error != "" {
		return devtools.IndexPatch{}, fmt.Errorf("project ast worker: %s", result.Error)
	}
	return result.Patch, nil
}

func (w *ProjectIndexWorker) IndexProjectSemanticPatch(ctx context.Context, root, configPath, projectName string, budget devtools.IndexPatchBudget) (devtools.IndexPatch, error) {
	req := projectIndexRequest{
		Method:         "indexProjectSemantic",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		SemanticBudget: &budget,
	}
	resp, err := w.call(ctx, req)
	if err != nil {
		return devtools.IndexPatch{}, err
	}

	var result struct {
		Patch devtools.IndexPatch `json:"patch"`
		Error string              `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return devtools.IndexPatch{}, fmt.Errorf("unmarshal project semantic response: %w", err)
	}
	if result.Error != "" {
		return devtools.IndexPatch{}, fmt.Errorf("project semantic worker: %s", result.Error)
	}
	return result.Patch, nil
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
	resp, err := w.call(ctx, req)
	if err != nil {
		return devtools.ProjectIndexIncrementalResult{}, err
	}

	var result struct {
		Decision map[string]any                         `json:"decision"`
		Patches  []devtools.IndexPatch                  `json:"patches"`
		Report   devtools.ProjectIndexIncrementalReport `json:"report"`
		Error    string                                 `json:"error,omitempty"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return devtools.ProjectIndexIncrementalResult{}, fmt.Errorf("unmarshal project incremental response: %w", err)
	}
	if result.Error != "" {
		return devtools.ProjectIndexIncrementalResult{}, fmt.Errorf("project incremental worker: %s", result.Error)
	}
	return devtools.ProjectIndexIncrementalResult{
		Decision: result.Decision,
		Patches:  result.Patches,
		Report:   result.Report,
	}, nil
}

func (w *ProjectIndexWorker) sourceOnlyFallback(ctx context.Context, req projectIndexRequest, cause error) (json.RawMessage, error) {
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
	resp, err := w.call(fallbackCtx, req)
	if err != nil {
		return nil, fmt.Errorf("project index source-only fallback after worker failure (%s): %w", cause.Error(), err)
	}
	return resp, nil
}

func (w *ProjectIndexWorker) call(ctx context.Context, req any) (json.RawMessage, error) {
	return nodeworker.CallRaw(ctx, w.worker, req)
}

// Close shuts down the worker process.
func (w *ProjectIndexWorker) Close() error {
	if w == nil {
		return nil
	}
	return w.worker.Close()
}
