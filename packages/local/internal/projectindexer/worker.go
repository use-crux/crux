package projectindexer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	runtimeworker "github.com/use-crux/crux/packages/local/internal/projectindexer/runtime"
	semanticworker "github.com/use-crux/crux/packages/local/internal/projectindexer/semantic"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// Worker runs project-indexer.mjs through the V2 NDJSON worker protocol.
type Worker struct {
	scriptPath     string
	scriptContent  []byte
	worker         *nodeworker.Worker
	semanticWorker *semanticworker.Worker
	runtimeWorker  *runtimeworker.Worker
	syntaxParser   SyntaxParser
	timingsMu      sync.Mutex
	lastAstTiming  ProjectIndexAstTiming
	planMu         sync.Mutex
	activePlan     *projectStaticSyntaxPlanCall
}

type projectIndexRequest struct {
	ProtocolVersion               int                                  `json:"protocolVersion,omitempty"`
	Method                        string                               `json:"method"`
	RequestID                     string                               `json:"requestId,omitempty"`
	RequestKind                   string                               `json:"requestKind,omitempty"`
	Root                          string                               `json:"root"`
	ConfigPath                    string                               `json:"configPath,omitempty"`
	ProjectName                   string                               `json:"projectName,omitempty"`
	ResolutionMode                string                               `json:"resolutionMode,omitempty"`
	SemanticBudget                *devtools.IndexPatchBudget           `json:"semanticBudget,omitempty"`
	PreviousIndex                 *store.IndexData                     `json:"previousIndex,omitempty"`
	PreviousDefinitions           []store.ProjectDefinition            `json:"previousIndexDefinitions,omitempty"`
	PreviousSources               []store.IndexSourceFile              `json:"previousIndexSources,omitempty"`
	Files                         []string                             `json:"files,omitempty"`
	DeletedFiles                  []string                             `json:"deletedFiles,omitempty"`
	SyntaxRecords                 []json.RawMessage                    `json:"syntaxRecords,omitempty"`
	SyntaxRecordsBatch            []json.RawMessage                    `json:"syntaxRecordsBatch,omitempty"`
	SyntaxFrontend                *devtools.SyntaxFrontend             `json:"syntaxFrontendIdentity,omitempty"`
	NativeFactProjection          string                               `json:"nativeFactProjection,omitempty"`
	Jobs                          []json.RawMessage                    `json:"jobs,omitempty"`
	Graph                         json.RawMessage                      `json:"graph,omitempty"`
	AvailableFacts                json.RawMessage                      `json:"availableFacts,omitempty"`
	NativeLintFinalize            bool                                 `json:"nativeLintFinalize,omitempty"`
	DependencyClosure             []string                             `json:"dependencyClosure,omitempty"`
	SourceProfile                 *devtools.SemanticSourceProfile      `json:"sourceProfile,omitempty"`
	SourceProfileFiles            []devtools.SemanticSourceProfileFile `json:"sourceProfileFiles,omitempty"`
	Mode                          string                               `json:"mode,omitempty"`
	MaxAffectedFiles              int                                  `json:"maxAffectedFiles,omitempty"`
	IncludeStaticCacheStatus      bool                                 `json:"includeStaticCacheStatus,omitempty"`
	StaticCacheHits               []devtools.StaticCacheHit            `json:"staticCacheHits,omitempty"`
	NativeCompilerProtocolVersion int                                  `json:"nativeCompilerProtocolVersion,omitempty"`
}

const workerMaxResponseBytes = 16 * 1024 * 1024
const workerProducer = "@crux/indexer/project-indexer"

// New creates a Project Index worker backed by the configured worker scripts.
func New(options WorkerOptions) *Worker {
	return &Worker{
		scriptPath:    options.ProjectIndexerScript,
		scriptContent: options.Assets.ProjectIndexer,
		worker:        newNodeStreamWorker("project-indexer", options.Assets.ProjectIndexer, options.ProjectIndexerScript),
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
func (w *Worker) LastSemanticTimings() []devtools.ProjectIndexPhaseTiming {
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
func (w *Worker) InspectProjectConfig(ctx context.Context, root, configPath, projectName string) (json.RawMessage, error) {
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

func (w *Worker) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string) (devtools.IndexPatch, error) {
	result, err := w.IndexProjectAstPatchWithResult(ctx, root, configPath, projectName)
	if err != nil {
		return devtools.IndexPatch{}, err
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
) (devtools.ProjectAstIndexResult, error) {
	if w.syntaxParser != nil {
		return w.indexProjectAstPatchResultFromNativeSyntaxRecords(ctx, root, configPath, projectName)
	}
	patch, err := w.indexProjectAstPatchFromTypeScript(ctx, root, configPath, projectName)
	if err != nil {
		return devtools.ProjectAstIndexResult{}, err
	}
	return devtools.ProjectAstIndexResult{Patch: patch}, nil
}

func (w *Worker) indexProjectAstPatchFromTypeScript(ctx context.Context, root, configPath, projectName string) (devtools.IndexPatch, error) {
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

func (w *Worker) IndexProjectSemanticPatch(ctx context.Context, request devtools.ProjectSemanticIndexRequest) (devtools.IndexPatch, error) {
	if w.semanticWorker == nil {
		return devtools.IndexPatch{}, fmt.Errorf("project semantic worker is not configured")
	}
	return w.semanticWorker.IndexProjectSemanticPatch(ctx, request)
}

func (w *Worker) IndexProjectRuntimePatch(ctx context.Context, request devtools.ProjectRuntimeIndexRequest) (devtools.IndexPatch, error) {
	if w.runtimeWorker == nil {
		return devtools.IndexPatch{}, fmt.Errorf("project runtime worker is not configured")
	}
	return w.runtimeWorker.IndexProjectRuntimePatch(ctx, request)
}

func (w *Worker) IndexProjectIncremental(ctx context.Context, root, configPath, projectName string, previousIndex store.IndexData, files []string, deletedFiles []string, mode string) (devtools.ProjectIndexIncrementalResult, error) {
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
