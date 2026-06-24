package indexhost

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/indexhost/indexwire"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/syntax"
	"github.com/use-crux/crux/packages/local/internal/indexhost/node"
	runtimeworker "github.com/use-crux/crux/packages/local/internal/indexhost/runtime"
	semanticworker "github.com/use-crux/crux/packages/local/internal/indexhost/semantic"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// Worker runs project-indexer.mjs through the V2 NDJSON worker protocol.
type Worker struct {
	scriptPath     string
	scriptContent  []byte
	worker         *nodeworker.Worker
	semanticWorker *semanticworker.Worker
	runtimeWorker  *runtimeworker.Worker
	syntaxParser   syntax.Parser
	timingsMu      sync.Mutex
	lastAstTiming  ProjectIndexAstTiming
	planMu         sync.Mutex
	activePlan     *projectStaticSyntaxPlanCall
}

const workerMaxResponseBytes = 16 * 1024 * 1024
const workerProducer = "@crux/indexer/project-indexer"

// New creates a Project Index worker backed by the configured worker scripts.
func New(options WorkerOptions) *Worker {
	return &Worker{
		scriptPath:    options.ProjectIndexerScript,
		scriptContent: options.Assets.ProjectIndexer,
		worker:        node.NewWorker("project-indexer", options.Assets.ProjectIndexer, options.ProjectIndexerScript, workerMaxResponseBytes),
		semanticWorker: semanticworker.New(semanticworker.Options{
			ScriptPath:    options.ProjectSemanticIndexerScript,
			ScriptContent: options.Assets.ProjectSemanticIndexer,
		}),
		runtimeWorker: runtimeworker.New(runtimeworker.Options{
			ScriptPath:    options.ProjectRuntimeIndexerScript,
			ScriptContent: options.Assets.ProjectRuntimeIndexer,
		}),
		syntaxParser: syntaxWorkerFromEnv(),
	}
}

// LastAstTiming returns timing metadata from the most recent AST index run.
func (w *Worker) LastAstTiming() ProjectIndexAstTiming {
	if w == nil {
		return ProjectIndexAstTiming{}
	}
	w.timingsMu.Lock()
	defer w.timingsMu.Unlock()
	return w.lastAstTiming
}

// LastSemanticTimings returns diagnostic timing buckets from the latest semantic request.
func (w *Worker) LastSemanticTimings() []projectindex.ProjectIndexPhaseTiming {
	if w == nil || w.semanticWorker == nil {
		return nil
	}
	return w.semanticWorker.LastSemanticTimings()
}

func (w *Worker) recordLastAstTiming(timing ProjectIndexAstTiming) {
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
func (w *Worker) ResolveProjectModel(ctx context.Context, root, configPath, projectName string) (json.RawMessage, error) {
	req := indexwire.Request{
		Method:         "resolveProjectModel",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "config-policy",
	}
	return w.streamArtifact(ctx, req, projectindex.ProjectIndexArtifactProjectModel)
}

// InspectProjectConfig returns the JSON-safe effective Crux configuration for
// root: every config() domain with resolved values and origin tags. Unlike
// ResolveProjectModel it imports the project's config (in inert CRUX_INDEX=1
// mode) so explicit overrides — not just defaults — are reflected.
func (w *Worker) InspectProjectConfig(ctx context.Context, root, configPath, projectName string) (json.RawMessage, error) {
	req := indexwire.Request{
		Method:         "inspectProjectConfig",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "config-policy",
	}
	resp, err := w.streamArtifact(ctx, req, projectindex.ProjectIndexArtifactProjectConfig)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, err
		}
		resp, err = w.sourceOnlyArtifactFallback(ctx, req, projectindex.ProjectIndexArtifactProjectConfig, err)
		if err != nil {
			return nil, err
		}
	}
	return resp, nil
}

func (w *Worker) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string) (projectindex.IndexPatch, error) {
	result, err := w.IndexProjectAstPatchWithResult(ctx, root, configPath, projectName)
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	return result.Patch, nil
}

// IndexProjectAstPatchWithResult returns the AST/source patch with per-run
// metadata used by later phases. Unlike LastAstTiming, this result belongs to
// the current call and is safe to pass through concurrent service scheduling.
func (w *Worker) IndexProjectAstPatchWithResult(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (projectindex.ProjectAstIndexResult, error) {
	if w.syntaxParser != nil {
		return w.indexProjectAstPatchResultFromNativeSyntaxRecords(ctx, root, configPath, projectName)
	}
	patch, err := w.indexProjectAstPatchFromTypeScript(ctx, root, configPath, projectName)
	if err != nil {
		return projectindex.ProjectAstIndexResult{}, err
	}
	return projectindex.ProjectAstIndexResult{Patch: patch}, nil
}

func (w *Worker) indexProjectAstPatchFromTypeScript(ctx context.Context, root, configPath, projectName string) (projectindex.IndexPatch, error) {
	started := time.Now()
	req := indexwire.Request{
		Method:         "indexProjectAst",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "source-only",
	}
	collector, err := w.streamCollector(ctx, req, projectindex.IndexPatchBudget{})
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	patches, err := collector.Patches()
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	if len(patches) != 1 {
		return projectindex.IndexPatch{}, fmt.Errorf("project ast worker returned %d patches, want 1", len(patches))
	}
	w.recordLastAstTiming(projectIndexAstTimingNodeRequired(ProjectIndexAstTiming{
		TotalMs:     elapsedMs(started),
		NodeTimings: collector.Timings(),
	}, projectIndexNodeReasonTypeScriptStaticCompiler))
	return patches[0], nil
}

func projectIndexAstTimingNodeRequired(timing ProjectIndexAstTiming, reasons ...string) ProjectIndexAstTiming {
	if len(reasons) == 0 {
		return timing
	}
	timing.NodeStarted = true
	timing.NativeOnlyEligible = false
	timing.NodeReasons = appendUniqueStrings(timing.NodeReasons, reasons...)
	timing.NativeOnlyReasons = appendUniqueStrings(timing.NativeOnlyReasons, reasons...)
	return timing
}

func appendUniqueStrings(values []string, next ...string) []string {
	for _, value := range next {
		if value == "" || stringSliceContains(values, value) {
			continue
		}
		values = append(values, value)
	}
	return values
}

func stringSliceContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func (w *Worker) IndexProjectSemanticPatch(ctx context.Context, request projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	if w.semanticWorker == nil {
		return projectindex.IndexPatch{}, fmt.Errorf("project semantic worker is not configured")
	}
	return w.semanticWorker.IndexProjectSemanticPatch(ctx, request)
}

func (w *Worker) IndexProjectRuntimePatch(ctx context.Context, request projectindex.ProjectRuntimeIndexRequest) (projectindex.IndexPatch, error) {
	if w.runtimeWorker == nil {
		return projectindex.IndexPatch{}, fmt.Errorf("project runtime worker is not configured")
	}
	return w.runtimeWorker.IndexProjectRuntimePatch(ctx, request)
}

func (w *Worker) IndexProjectIncremental(ctx context.Context, root, configPath, projectName string, previousIndex store.IndexData, files []string, deletedFiles []string, mode string) (projectindex.ProjectIndexIncrementalResult, error) {
	if mode == "" {
		mode = "ast"
	}
	req := indexwire.Request{
		Method:        "indexProjectIncremental",
		Root:          root,
		ConfigPath:    configPath,
		ProjectName:   projectName,
		PreviousIndex: &previousIndex,
		Files:         files,
		DeletedFiles:  deletedFiles,
		Mode:          mode,
	}
	collector, err := w.streamCollector(ctx, req, projectindex.IndexPatchBudget{})
	if err != nil {
		return projectindex.ProjectIndexIncrementalResult{}, err
	}
	return collector.IncrementalResult()
}

// Close shuts down the worker process.
func (w *Worker) Close() error {
	var closeErrs []error
	if w.worker != nil {
		if err := w.worker.Close(); err != nil {
			closeErrs = append(closeErrs, err)
		}
	}
	if w.semanticWorker != nil {
		if err := w.semanticWorker.Close(); err != nil {
			closeErrs = append(closeErrs, err)
		}
	}
	if w.runtimeWorker != nil {
		if err := w.runtimeWorker.Close(); err != nil {
			closeErrs = append(closeErrs, err)
		}
	}
	if w.syntaxParser != nil {
		if err := w.syntaxParser.Close(); err != nil {
			closeErrs = append(closeErrs, err)
		}
	}
	return errors.Join(closeErrs...)
}
