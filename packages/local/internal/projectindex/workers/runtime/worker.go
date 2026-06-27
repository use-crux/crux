package runtime

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/node"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/source"
)

const (
	maxResponseBytes = 16 * 1024 * 1024
	producer         = "@use-crux/indexer/project-runtime-indexer"
)

// Options configures the runtime worker process.
type Options struct {
	ScriptPath    string
	ScriptContent []byte
}

// Worker runs explicit runtime-rich Project Index evidence collection through
// its own V2 NDJSON worker process.
type Worker struct {
	phase source.Client
}

// New creates a runtime worker backed by project-runtime-indexer.mjs.
func New(options Options) *Worker {
	return &Worker{
		phase: source.Client{
			Name:          "project-runtime-indexer",
			ScriptContent: options.ScriptContent,
			ScriptPath:    options.ScriptPath,
			Worker:        node.NewWorker("project-runtime-indexer", options.ScriptContent, options.ScriptPath, maxResponseBytes),
			MaxBytes:      maxResponseBytes,
			Producer:      producer,
		},
	}
}

func (w *Worker) IndexProjectRuntimePatch(ctx context.Context, runtimeRequest projectindex.ProjectRuntimeIndexRequest) (projectindex.IndexPatch, error) {
	req := requestwire.Request{
		Method:        "indexProjectRuntime",
		Root:          runtimeRequest.Root,
		ConfigPath:    runtimeRequest.ConfigPath,
		ProjectName:   runtimeRequest.ProjectName,
		PreviousIndex: &runtimeRequest.PreviousIndex,
	}
	patches, err := w.phase.Patches(ctx, req, runtimeRequest.Budget)
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	if len(patches) != 1 {
		return projectindex.IndexPatch{}, fmt.Errorf("project runtime worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}

// Close shuts down the runtime worker process.
func (w *Worker) Close() error {
	if w == nil || w.phase.Worker == nil {
		return nil
	}
	return w.phase.Worker.Close()
}
