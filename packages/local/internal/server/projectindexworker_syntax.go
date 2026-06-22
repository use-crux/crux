package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

const projectIndexerSyntaxWorkerEnv = "CRUX_INDEXER_SYNTAX_WORKER"
const projectIndexerSyntaxWorkerPoolSizeEnv = "CRUX_INDEXER_SYNTAX_WORKER_POOL_SIZE"
const projectIndexerNativeStaticCacheStatusEnv = "CRUX_INDEXER_NATIVE_STATIC_CACHE_STATUS"

var osExecutable = os.Executable

// WithProjectSyntaxWorker enables the native Rust/Oxc static syntax path.
func (w *ProjectIndexWorker) WithProjectSyntaxWorker(worker ProjectSyntaxParser) *ProjectIndexWorker {
	w.syntaxWorker = worker
	return w
}

func projectSyntaxWorkerFromEnv() ProjectSyntaxParser {
	commandPath, ok := projectSyntaxWorkerCommandPath()
	if !ok {
		return nil
	}
	if strings.TrimSpace(os.Getenv(projectIndexerSyntaxWorkerPoolSizeEnv)) == "" {
		return NewAdaptiveProjectSyntaxWorkerPool(defaultProjectSyntaxWorkerPoolSize(), commandPath, "serve")
	}
	return NewProjectSyntaxWorkerPool(projectSyntaxWorkerPoolSizeFromEnv(), commandPath, "serve")
}

func projectSyntaxWorkerCommandPath() (string, bool) {
	if explicit := strings.TrimSpace(os.Getenv(projectIndexerSyntaxWorkerEnv)); explicit != "" {
		return explicit, true
	}
	executable, err := osExecutable()
	if err != nil || executable == "" {
		return "", false
	}
	candidate := filepath.Join(filepath.Dir(executable), projectSyntaxWorkerBinaryName())
	info, err := os.Stat(candidate)
	if err != nil || info.IsDir() {
		return "", false
	}
	return candidate, true
}

func projectSyntaxWorkerBinaryName() string {
	if runtime.GOOS == "windows" {
		return "crux-indexer-syntax.exe"
	}
	return "crux-indexer-syntax"
}

func projectSyntaxWorkerPoolSizeFromEnv() int {
	explicit := strings.TrimSpace(os.Getenv(projectIndexerSyntaxWorkerPoolSizeEnv))
	if explicit == "" {
		return defaultProjectSyntaxWorkerPoolSize()
	}
	size, err := strconv.Atoi(explicit)
	if err != nil || size < 1 {
		slog.Warn("invalid project syntax worker pool size", "env", projectIndexerSyntaxWorkerPoolSizeEnv, "value", explicit)
		return defaultProjectSyntaxWorkerPoolSize()
	}
	return size
}

func defaultProjectSyntaxWorkerPoolSize() int {
	size := runtime.GOMAXPROCS(0)
	if size < 1 {
		return 1
	}
	if size > 4 {
		return 4
	}
	return size
}

func nativeStaticCacheStatusEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(projectIndexerNativeStaticCacheStatusEnv)))
	return value != "0" && value != "false" && value != "off"
}

// InspectProjectStaticSyntaxPlan returns the Node-owned static parser plan used
// by the native syntax worker path.
func (w *ProjectIndexWorker) InspectProjectStaticSyntaxPlan(ctx context.Context, root, configPath, projectName string) (devtools.ProjectStaticSyntaxPlan, error) {
	req := projectIndexRequest{
		Method:                   "inspectProjectStaticSyntaxPlan",
		Root:                     root,
		ConfigPath:               configPath,
		ProjectName:              projectName,
		ResolutionMode:           "source-only",
		IncludeStaticCacheStatus: nativeStaticCacheStatusEnabled(),
	}
	resp, err := w.streamArtifact(ctx, req, devtools.ProjectIndexArtifactStaticSyntaxPlan)
	if err != nil {
		return devtools.ProjectStaticSyntaxPlan{}, err
	}
	var plan devtools.ProjectStaticSyntaxPlan
	if err := json.Unmarshal(resp, &plan); err != nil {
		return devtools.ProjectStaticSyntaxPlan{}, fmt.Errorf("decode project static syntax plan: %w", err)
	}
	return plan, nil
}

func (w *ProjectIndexWorker) indexProjectAstPatchFromNativeSyntaxRecords(ctx context.Context, root, configPath, projectName string) (devtools.IndexPatch, error) {
	started := time.Now()
	planStarted := time.Now()
	plan, err := w.InspectProjectStaticSyntaxPlan(ctx, root, configPath, projectName)
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	timing := ProjectIndexAstTiming{PlanMs: elapsedMs(planStarted)}
	if !plan.NativeAstEnabled {
		patch, err := w.indexProjectAstPatchFromTypeScript(ctx, root, configPath, projectName)
		fallbackTiming := w.LastAstTiming()
		fallbackTiming.PlanMs = timing.PlanMs
		fallbackTiming.TotalMs = elapsedMs(started)
		w.recordLastAstTiming(fallbackTiming)
		return patch, err
	}
	if streamParser, ok := w.syntaxWorker.(ProjectSyntaxBatchStreamParser); ok {
		patch, streamTiming, err := w.indexProjectAstPatchFromNativeSyntaxRecordStream(ctx, root, configPath, projectName, plan, streamParser)
		streamTiming.PlanMs = timing.PlanMs
		streamTiming.TotalMs = elapsedMs(started)
		w.recordLastAstTiming(streamTiming)
		return patch, err
	}
	collectStarted := time.Now()
	records, err := w.collectProjectSyntaxRecords(ctx, plan)
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	timing.NativeParseAndForwardMs = elapsedMs(collectStarted)
	for _, record := range records {
		timing.RecordCount++
		timing.RecordBytes += len(record)
	}
	projectStarted := time.Now()
	patch, err := w.indexProjectAstFromSyntaxRecordsPatch(ctx, root, configPath, projectName, records, projectSyntaxFrontendIdentity(plan), plan.CacheEntries)
	timing.NodeProjectionMs = elapsedMs(projectStarted)
	timing.TotalMs = elapsedMs(started)
	w.recordLastAstTiming(timing)
	return patch, err
}

func elapsedMs(started time.Time) float64 {
	return float64(time.Since(started).Microseconds()) / 1000
}

func (w *ProjectIndexWorker) collectProjectSyntaxRecords(ctx context.Context, plan devtools.ProjectStaticSyntaxPlan) ([]json.RawMessage, error) {
	if w.syntaxWorker == nil {
		return nil, fmt.Errorf("project syntax worker is not configured")
	}
	files := projectSyntaxPlanFilesToParse(plan)
	records := make([]json.RawMessage, len(files))
	if len(files) == 0 {
		return records, nil
	}
	if batchParser, ok := w.syntaxWorker.(ProjectSyntaxBatchParser); ok {
		return w.collectProjectSyntaxRecordsBatch(ctx, plan, batchParser)
	}

	concurrency := w.syntaxWorker.Concurrency()
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > len(files) {
		concurrency = len(files)
	}

	type syntaxJob struct {
		index int
		file  string
	}

	parseCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	jobs := make(chan syntaxJob)
	var wg sync.WaitGroup
	var errOnce sync.Once
	var firstErr error
	setErr := func(err error) {
		errOnce.Do(func() {
			firstErr = err
			cancel()
		})
	}

	for range concurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				if err := parseCtx.Err(); err != nil {
					setErr(err)
					return
				}
				record, err := w.parseProjectSyntaxRecord(parseCtx, plan, job.file)
				if err != nil {
					setErr(err)
					return
				}
				records[job.index] = record
			}
		}()
	}

sendJobs:
	for index, file := range files {
		select {
		case <-parseCtx.Done():
			break sendJobs
		case jobs <- syntaxJob{index: index, file: file}:
		}
	}
	close(jobs)
	wg.Wait()

	if firstErr != nil {
		return nil, firstErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

func (w *ProjectIndexWorker) collectProjectSyntaxRecordsBatch(ctx context.Context, plan devtools.ProjectStaticSyntaxPlan, parser ProjectSyntaxBatchParser) ([]json.RawMessage, error) {
	return parser.ParseFiles(ctx, projectSyntaxParseRequestsFromPlan(plan))
}

func projectSyntaxParseRequestsFromPlan(plan devtools.ProjectStaticSyntaxPlan) []ProjectSyntaxParseRequest {
	files := projectSyntaxPlanFilesToParse(plan)
	requests := make([]ProjectSyntaxParseRequest, 0, len(files))
	for _, file := range files {
		requests = append(requests, ProjectSyntaxParseRequest{
			Root:                     plan.Root,
			File:                     file,
			ReadSourceFromDisk:       true,
			CallNames:                plan.CallNames,
			CallInterests:            projectSyntaxCallInterests(plan.CallInterests),
			ConstructorNames:         plan.ConstructorNames,
			ConstructorInterests:     projectSyntaxConstructorInterests(plan.ConstructorInterests),
			PruneNativeFactCallNames: plan.PruneNativeFactCallNames,
		})
	}
	return requests
}

func projectSyntaxPlanFilesToParse(plan devtools.ProjectStaticSyntaxPlan) []string {
	if plan.FilesToParse != nil {
		return plan.FilesToParse
	}
	return plan.Files
}

func (w *ProjectIndexWorker) parseProjectSyntaxRecord(ctx context.Context, plan devtools.ProjectStaticSyntaxPlan, file string) (json.RawMessage, error) {
	source, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("read source for native syntax record %s: %w", file, err)
	}
	record, err := w.syntaxWorker.ParseFile(ctx, ProjectSyntaxParseRequest{
		Root:                     plan.Root,
		File:                     file,
		Source:                   string(source),
		CallNames:                plan.CallNames,
		CallInterests:            projectSyntaxCallInterests(plan.CallInterests),
		ConstructorNames:         plan.ConstructorNames,
		ConstructorInterests:     projectSyntaxConstructorInterests(plan.ConstructorInterests),
		PruneNativeFactCallNames: plan.PruneNativeFactCallNames,
	})
	if err != nil {
		return nil, fmt.Errorf("parse native syntax record %s: %w", file, err)
	}
	return record, nil
}

func projectSyntaxCallInterests(input []devtools.StaticCallInterest) []projectSyntaxCallInterest {
	if len(input) == 0 {
		return nil
	}
	interests := make([]projectSyntaxCallInterest, 0, len(input))
	for _, interest := range input {
		interests = append(interests, projectSyntaxCallInterest{
			Name:       interest.Name,
			ImportFrom: append([]string(nil), interest.ImportFrom...),
			ConfigArg:  interest.ConfigArg,
			Properties: append([]string(nil), interest.Properties...),
			Callbacks:  projectSyntaxCallbackInterests(interest.Callbacks),
			Source:     interest.Source,
		})
	}
	return interests
}

func projectSyntaxConstructorInterests(input []devtools.StaticConstructorInterest) []projectSyntaxConstructorInterest {
	if len(input) == 0 {
		return nil
	}
	interests := make([]projectSyntaxConstructorInterest, 0, len(input))
	for _, interest := range input {
		interests = append(interests, projectSyntaxConstructorInterest{
			Name:       interest.Name,
			ImportFrom: append([]string(nil), interest.ImportFrom...),
			ConfigArg:  interest.ConfigArg,
			Properties: append([]string(nil), interest.Properties...),
			Callbacks:  projectSyntaxCallbackInterests(interest.Callbacks),
			Source:     interest.Source,
		})
	}
	return interests
}

func projectSyntaxCallbackInterests(input []devtools.StaticCallbackInterest) []projectSyntaxCallbackInterest {
	if len(input) == 0 {
		return nil
	}
	interests := make([]projectSyntaxCallbackInterest, 0, len(input))
	for _, interest := range input {
		interests = append(interests, projectSyntaxCallbackInterest{
			Property: interest.Property,
			MaxDepth: interest.MaxDepth,
		})
	}
	return interests
}

// IndexProjectAstFromSyntaxRecordsPatch projects native static syntax records
// through the Node compiler and TypeScript extension runtime.
func (w *ProjectIndexWorker) IndexProjectAstFromSyntaxRecordsPatch(ctx context.Context, root, configPath, projectName string, records []json.RawMessage, syntaxFrontend ...*devtools.SyntaxFrontend) (devtools.IndexPatch, error) {
	var identity *devtools.SyntaxFrontend
	if len(syntaxFrontend) > 0 {
		identity = syntaxFrontend[0]
	}
	return w.indexProjectAstFromSyntaxRecordsPatch(ctx, root, configPath, projectName, records, identity, nil)
}

func (w *ProjectIndexWorker) indexProjectAstFromSyntaxRecordsPatch(ctx context.Context, root, configPath, projectName string, records []json.RawMessage, identity *devtools.SyntaxFrontend, staticCacheHits []devtools.StaticCacheHit) (devtools.IndexPatch, error) {
	req := projectIndexRequest{
		Method:          "indexProjectAstFromSyntaxRecords",
		Root:            root,
		ConfigPath:      configPath,
		ProjectName:     projectName,
		ResolutionMode:  "source-only",
		SyntaxRecords:   records,
		SyntaxFrontend:  identity,
		StaticCacheHits: staticCacheHits,
	}
	patches, err := w.streamPatches(ctx, req, devtools.IndexPatchBudget{})
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	if len(patches) != 1 {
		return devtools.IndexPatch{}, fmt.Errorf("project ast syntax-record worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}
