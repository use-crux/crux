package server

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

// ProjectRuntimeWorker runs explicit runtime-rich Project Index evidence
// collection through its own V2 NDJSON worker process.
type ProjectRuntimeWorker struct {
	scriptPath string
	worker     *nodeworker.Worker
}

const projectRuntimeWorkerProducer = "@crux/indexer/project-runtime-indexer"

// NewProjectRuntimeWorker creates a runtime worker backed by project-runtime-indexer.mjs.
func NewProjectRuntimeWorker(scriptPath string) *ProjectRuntimeWorker {
	return &ProjectRuntimeWorker{
		scriptPath: scriptPath,
		worker:     newNodeStreamWorker("project-runtime-indexer", embeddedProjectRuntimeIndexer, scriptPath),
	}
}

func (w *ProjectRuntimeWorker) IndexProjectRuntimePatch(ctx context.Context, request devtools.ProjectRuntimeIndexRequest) (devtools.IndexPatch, error) {
	req := projectIndexRequest{
		Method:        "indexProjectRuntime",
		Root:          request.Root,
		ConfigPath:    request.ConfigPath,
		ProjectName:   request.ProjectName,
		PreviousIndex: &request.PreviousIndex,
	}
	patches, err := w.streamPatches(ctx, req, request.Budget)
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	if len(patches) != 1 {
		return devtools.IndexPatch{}, fmt.Errorf("project runtime worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}

func (w *ProjectRuntimeWorker) streamPatches(ctx context.Context, req projectIndexRequest, budget devtools.IndexPatchBudget) ([]devtools.IndexPatch, error) {
	collector := devtools.NewProjectIndexPatchStreamCollector(devtools.ProjectIndexPatchStreamOptions{
		Root:             req.Root,
		Budget:           budget,
		MaxBytes:         projectIndexWorkerMaxResponseBytes,
		MaxFactsPerBatch: projectIndexWorkerMaxFactsPerBatch(req.Method),
		Producer:         projectRuntimeWorkerProducer,
	})
	err := w.streamRequest(ctx, req, collector.Handle, func() bool {
		return collector.CompletedPatchCount() >= 1
	})
	if err != nil {
		return nil, err
	}
	return collector.Patches()
}

func (w *ProjectRuntimeWorker) streamRequest(ctx context.Context, req projectIndexRequest, handle func(json.RawMessage) error, done func() bool) error {
	req.ProtocolVersion = 2
	requests := runtimeWorkerRequestBatch(req)
	return nodeworker.StreamCallBatch(ctx, w.worker, requests, func(raw json.RawMessage) (bool, error) {
		if err := handle(raw); err != nil {
			return false, err
		}
		return done(), nil
	})
}

// Close shuts down the runtime worker process.
func (w *ProjectRuntimeWorker) Close() error {
	if w == nil || w.worker == nil {
		return nil
	}
	return w.worker.Close()
}

func runtimeWorkerRequestBatch(req projectIndexRequest) []any {
	if !shouldChunkRuntimeRequest(req) {
		return []any{req}
	}
	requestID := fmt.Sprintf("runtime:%d", time.Now().UnixNano())
	events := []any{projectIndexWorkerStartRequest(req, requestID)}
	events = appendProjectIndexPreviousIndexBatches(events, req, requestID)
	events = append(events, projectIndexRequest{
		ProtocolVersion: 2,
		Method:          req.Method,
		RequestID:       requestID,
		RequestKind:     "done",
	})
	return events
}

func shouldChunkRuntimeRequest(req projectIndexRequest) bool {
	return req.Method == "indexProjectRuntime" &&
		req.PreviousIndex != nil &&
		(len(req.PreviousIndex.Definitions) > 0 || len(req.PreviousIndex.Sources) > 0)
}
