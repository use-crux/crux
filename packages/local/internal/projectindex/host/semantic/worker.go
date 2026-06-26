package semantic

import (
	"context"
	"fmt"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/client"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/indexwire"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/node"
)

const (
	maxResponseBytes = 16 * 1024 * 1024
	producer         = "@use-crux/indexer/project-indexer"
)

// Options configures the semantic worker process.
type Options struct {
	ScriptPath    string
	ScriptContent []byte
}

// Worker runs semantic Project Index enrichment through its own V2 NDJSON
// worker process.
type Worker struct {
	phase       client.Client
	mu          sync.Mutex
	lastTimings []projectindex.ProjectIndexPhaseTiming
}

// New creates a semantic worker backed by project-semantic-indexer.mjs.
func New(options Options) *Worker {
	return &Worker{
		phase: client.Client{
			Name:          "project-semantic-indexer",
			ScriptContent: options.ScriptContent,
			ScriptPath:    options.ScriptPath,
			Worker:        node.NewWorker("project-semantic-indexer", options.ScriptContent, options.ScriptPath, maxResponseBytes),
			MaxBytes:      maxResponseBytes,
			Producer:      producer,
		},
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
	collector, err := w.phase.Collector(ctx, req, semanticRequest.Budget)
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	patches, err := collector.Patches()
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	w.setLastTimings(collector.Timings())
	if len(patches) != 1 {
		return projectindex.IndexPatch{}, fmt.Errorf("project semantic worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}

// Close shuts down the semantic worker process.
func (w *Worker) Close() error {
	if w == nil || w.phase.Worker == nil {
		return nil
	}
	return w.phase.Worker.Close()
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
