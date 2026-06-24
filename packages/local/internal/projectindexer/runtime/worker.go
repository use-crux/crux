package runtime

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/indexwire"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/nodehost"
)

const (
	maxResponseBytes = 16 * 1024 * 1024
	producer         = "@crux/indexer/project-runtime-indexer"
)

// Options configures the runtime worker process.
type Options struct {
	ScriptPath    string
	ScriptContent []byte
}

// Worker runs explicit runtime-rich Project Index evidence collection through
// its own V2 NDJSON worker process.
type Worker struct {
	scriptPath string
	worker     *nodeworker.Worker
}

// New creates a runtime worker backed by project-runtime-indexer.mjs.
func New(options Options) *Worker {
	return &Worker{
		scriptPath: options.ScriptPath,
		worker:     nodehost.NewWorker("project-runtime-indexer", options.ScriptContent, options.ScriptPath, maxResponseBytes),
	}
}

func (w *Worker) IndexProjectRuntimePatch(ctx context.Context, runtimeRequest projectindex.ProjectRuntimeIndexRequest) (projectindex.IndexPatch, error) {
	req := indexwire.Request{
		Method:        "indexProjectRuntime",
		Root:          runtimeRequest.Root,
		ConfigPath:    runtimeRequest.ConfigPath,
		ProjectName:   runtimeRequest.ProjectName,
		PreviousIndex: &runtimeRequest.PreviousIndex,
	}
	patches, err := w.streamPatches(ctx, req, runtimeRequest.Budget)
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	if len(patches) != 1 {
		return projectindex.IndexPatch{}, fmt.Errorf("project runtime worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}

func (w *Worker) streamPatches(ctx context.Context, req indexwire.Request, budget projectindex.IndexPatchBudget) ([]projectindex.IndexPatch, error) {
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
		return nil, err
	}
	return collector.Patches()
}

func (w *Worker) streamRequest(ctx context.Context, req indexwire.Request, handle func(json.RawMessage) error, done func() bool) error {
	req.ProtocolVersion = 2
	requests, err := indexwire.Batch(req)
	if err != nil {
		return err
	}
	return nodehost.StreamBatch(ctx, w.worker, requests, handle, done)
}

// Close shuts down the runtime worker process.
func (w *Worker) Close() error {
	if w == nil || w.worker == nil {
		return nil
	}
	return w.worker.Close()
}
