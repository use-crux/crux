package semantic

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sort"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/node"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/source"
)

const (
	maxResponseLineBytes   = 16 * 1024 * 1024
	maxResponseStreamBytes = 128 * 1024 * 1024
	producer               = "@use-crux/indexer/project-indexer"
)

// Options configures the semantic worker process.
type Options struct {
	ScriptPath     string
	ScriptContent  []byte
	MaxWorkers     int
	ProcessOptions []workerproc.Option
}

// Worker runs semantic Project Index enrichment through its own V3 NDJSON
// worker process.
type Worker struct {
	phases      []source.Client
	mu          sync.Mutex
	lastTimings []projectindex.ProjectIndexPhaseTiming
}

// New creates a semantic worker backed by project-semantic-indexer.mjs.
func New(options Options) *Worker {
	size := options.MaxWorkers
	if size < 1 {
		size = defaultMaxWorkers()
	}
	phases := make([]source.Client, 0, size)
	for i := 0; i < size; i++ {
		phases = append(phases, newPhaseClient(options))
	}
	return &Worker{phases: phases}
}

func (w *Worker) IndexProjectSemanticPatch(ctx context.Context, semanticRequest projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	if w == nil || len(w.phases) == 0 {
		return projectindex.IndexPatch{}, fmt.Errorf("project semantic worker is not configured")
	}
	if shards := projectindex.ProjectSemanticShardRequests(semanticRequest); len(shards) > 1 && len(w.phases) > 1 {
		return w.indexProjectSemanticShardPatches(ctx, shards)
	}
	patch, timings, err := w.indexProjectSemanticPatch(ctx, w.phases[0], semanticRequest)
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	w.setLastTimings(timings)
	return patch, nil
}

func newPhaseClient(options Options) source.Client {
	return source.Client{
		Name:           "project-semantic-indexer",
		ScriptContent:  options.ScriptContent,
		ScriptPath:     options.ScriptPath,
		Worker:         node.NewWorker("project-semantic-indexer", options.ScriptContent, options.ScriptPath, maxResponseLineBytes, options.ProcessOptions...),
		MaxLineBytes:   maxResponseLineBytes,
		MaxStreamBytes: maxResponseStreamBytes,
		Producer:       producer,
	}
}

func defaultMaxWorkers() int {
	size := runtime.GOMAXPROCS(0)
	if size < 1 {
		return 1
	}
	return size
}

func (w *Worker) indexProjectSemanticPatch(
	ctx context.Context,
	phase source.Client,
	semanticRequest projectindex.ProjectSemanticIndexRequest,
) (projectindex.IndexPatch, []projectindex.ProjectIndexPhaseTiming, error) {
	req := requestwire.Request{
		Method:         "indexProjectSemantic",
		Root:           semanticRequest.Root,
		ConfigPath:     semanticRequest.ConfigPath,
		ProjectName:    semanticRequest.ProjectName,
		SemanticBudget: &semanticRequest.Budget,
		PreviousIndex:  semanticRequest.PreviousIndex,
		Files:          semanticRequest.Files,
		SourceProfile:  semanticRequest.SourceProfile,
		CacheDisabled:  projectindex.CacheDisabled(ctx),
	}
	if len(semanticRequest.DependencyClosure) > 0 {
		req.DependencyClosure = semanticRequest.DependencyClosure
	}
	collector, err := phase.Collector(ctx, req, semanticRequest.Budget)
	if err != nil {
		return projectindex.IndexPatch{}, nil, err
	}
	patches, err := collector.Patches()
	if err != nil {
		return projectindex.IndexPatch{}, nil, err
	}
	if len(patches) != 1 {
		return projectindex.IndexPatch{}, nil, fmt.Errorf("project semantic worker returned %d patches, want 1", len(patches))
	}
	return patches[0], collector.Timings(), nil
}

func (w *Worker) indexProjectSemanticShardPatches(
	ctx context.Context,
	shards []projectindex.ProjectSemanticShardRequest,
) (projectindex.IndexPatch, error) {
	workerCount := len(w.phases)
	if workerCount > len(shards) {
		workerCount = len(shards)
	}
	shardCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	results := make([]semanticPatchResult, len(shards))
	var wg sync.WaitGroup
	for index, shard := range shards {
		index, shard := index, shard
		workerIndex := index % workerCount
		wg.Add(1)
		go func() {
			defer wg.Done()
			patch, timings, err := w.indexProjectSemanticPatch(shardCtx, w.phases[workerIndex], shard.Request)
			if err != nil {
				cancel()
			}
			results[index] = semanticPatchResult{patch: patch, timings: timings, err: err}
		}()
	}
	wg.Wait()

	patches := make([]projectindex.IndexPatch, 0, len(results))
	for _, result := range results {
		if result.err != nil {
			return projectindex.IndexPatch{}, result.err
		}
		patches = append(patches, result.patch)
	}
	patch, err := projectindex.MergeSemanticPatches(patches)
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	w.setLastTimings(mergeSemanticTimings(results))
	return patch, nil
}

// Close shuts down the semantic worker process.
func (w *Worker) Close() error {
	if w == nil {
		return nil
	}
	var closeErrs []error
	for _, phase := range w.phases {
		if phase.Worker == nil {
			continue
		}
		if err := phase.Worker.Close(); err != nil {
			closeErrs = append(closeErrs, err)
		}
	}
	return errors.Join(closeErrs...)
}

// LastSemanticTimings returns diagnostic timing buckets from the latest semantic request.
func (w *Worker) LastSemanticTimings() []projectindex.ProjectIndexPhaseTiming {
	if w == nil {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]projectindex.ProjectIndexPhaseTiming(nil), w.lastTimings...)
}

func (w *Worker) setLastTimings(timings []projectindex.ProjectIndexPhaseTiming) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.lastTimings = append([]projectindex.ProjectIndexPhaseTiming(nil), timings...)
}

type semanticPatchResult struct {
	patch   projectindex.IndexPatch
	timings []projectindex.ProjectIndexPhaseTiming
	err     error
}

func mergeSemanticTimings(results []semanticPatchResult) []projectindex.ProjectIndexPhaseTiming {
	merged := map[string]projectindex.ProjectIndexPhaseTiming{}
	for _, result := range results {
		for _, timing := range result.timings {
			current := merged[timing.Name]
			current.Name = timing.Name
			current.DurationMs += timing.DurationMs
			current.Count += timing.Count
			merged[timing.Name] = current
		}
	}
	names := make([]string, 0, len(merged))
	for name := range merged {
		names = append(names, name)
	}
	sort.Strings(names)
	timings := make([]projectindex.ProjectIndexPhaseTiming, 0, len(names))
	for _, name := range names {
		timings = append(timings, merged[name])
	}
	return timings
}
