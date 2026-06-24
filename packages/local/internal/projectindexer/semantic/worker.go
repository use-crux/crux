package semantic

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/indexwire"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/nodehost"
)

const (
	maxResponseBytes = 16 * 1024 * 1024
	producer         = "@crux/indexer/project-indexer"
)

// Options configures the semantic worker process.
type Options struct {
	ScriptPath    string
	ScriptContent []byte
}

// Worker runs semantic Project Index enrichment through its own V2 NDJSON
// worker process.
type Worker struct {
	scriptPath  string
	worker      *nodeworker.Worker
	mu          sync.Mutex
	lastTimings []projectindex.ProjectIndexPhaseTiming
}

// New creates a semantic worker backed by project-semantic-indexer.mjs.
func New(options Options) *Worker {
	return &Worker{
		scriptPath: options.ScriptPath,
		worker:     nodehost.NewWorker("project-semantic-indexer", options.ScriptContent, options.ScriptPath, maxResponseBytes),
	}
}

func (w *Worker) IndexProjectSemanticPatch(ctx context.Context, semanticRequest projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	req := indexwire.Request{
		Method:         "indexProjectSemantic",
		Root:           semanticRequest.Root,
		ConfigPath:     semanticRequest.ConfigPath,
		ProjectName:    semanticRequest.ProjectName,
		SemanticBudget: &semanticRequest.Budget,
		PreviousIndex:  semanticRequest.PreviousIndex,
		Files:          semanticRequest.Files,
		SourceProfile:  semanticRequest.SourceProfile,
	}
	if len(semanticRequest.DependencyClosure) > 0 {
		req.DependencyClosure = semanticRequest.DependencyClosure
	}
	patches, timings, err := w.streamPatches(ctx, req, semanticRequest.Budget)
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	w.setLastTimings(timings)
	if len(patches) != 1 {
		return projectindex.IndexPatch{}, fmt.Errorf("project semantic worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}

func (w *Worker) streamPatches(ctx context.Context, req indexwire.Request, budget projectindex.IndexPatchBudget) ([]projectindex.IndexPatch, []projectindex.ProjectIndexPhaseTiming, error) {
	collector := projectindex.NewProjectIndexPatchStreamCollector(projectindex.ProjectIndexPatchStreamOptions{
		Root:             req.Root,
		Budget:           budget,
		MaxBytes:         maxResponseBytes,
		MaxFactsPerBatch: 100,
		Producer:         producer,
	})
	err := w.streamRequest(ctx, req, collector.Handle, func() bool {
		return collector.CompletedPatchCount() >= 1
	})
	if err != nil {
		return nil, nil, err
	}
	patches, err := collector.Patches()
	if err != nil {
		return nil, nil, err
	}
	return patches, collector.Timings(), nil
}

func (w *Worker) streamRequest(ctx context.Context, req indexwire.Request, handle func(json.RawMessage) error, done func() bool) error {
	req.ProtocolVersion = 2
	requests, err := indexwire.Batch(req)
	if err != nil {
		return err
	}
	return nodehost.StreamBatch(ctx, w.worker, requests, handle, done)
}

// Close shuts down the semantic worker process.
func (w *Worker) Close() error {
	if w == nil || w.worker == nil {
		return nil
	}
	return w.worker.Close()
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
