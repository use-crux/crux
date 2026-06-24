package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/store"
)

const (
	maxResponseBytes = 16 * 1024 * 1024
	producer         = "@crux/indexer/project-runtime-indexer"
	requestBatchSize = 128
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

type request struct {
	ProtocolVersion     int                       `json:"protocolVersion,omitempty"`
	Method              string                    `json:"method"`
	RequestID           string                    `json:"requestId,omitempty"`
	RequestKind         string                    `json:"requestKind,omitempty"`
	Root                string                    `json:"root"`
	ConfigPath          string                    `json:"configPath,omitempty"`
	ProjectName         string                    `json:"projectName,omitempty"`
	PreviousIndex       *store.IndexData          `json:"previousIndex,omitempty"`
	PreviousDefinitions []store.ProjectDefinition `json:"previousIndexDefinitions,omitempty"`
	PreviousSources     []store.IndexSourceFile   `json:"previousIndexSources,omitempty"`
}

// New creates a runtime worker backed by project-runtime-indexer.mjs.
func New(options Options) *Worker {
	return &Worker{
		scriptPath: options.ScriptPath,
		worker:     newNodeStreamWorker("project-runtime-indexer", options.ScriptContent, options.ScriptPath),
	}
}

func (w *Worker) IndexProjectRuntimePatch(ctx context.Context, runtimeRequest devtools.ProjectRuntimeIndexRequest) (devtools.IndexPatch, error) {
	req := request{
		Method:        "indexProjectRuntime",
		Root:          runtimeRequest.Root,
		ConfigPath:    runtimeRequest.ConfigPath,
		ProjectName:   runtimeRequest.ProjectName,
		PreviousIndex: &runtimeRequest.PreviousIndex,
	}
	patches, err := w.streamPatches(ctx, req, runtimeRequest.Budget)
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	if len(patches) != 1 {
		return devtools.IndexPatch{}, fmt.Errorf("project runtime worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}

func (w *Worker) streamPatches(ctx context.Context, req request, budget devtools.IndexPatchBudget) ([]devtools.IndexPatch, error) {
	collector := devtools.NewProjectIndexPatchStreamCollector(devtools.ProjectIndexPatchStreamOptions{
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

func (w *Worker) streamRequest(ctx context.Context, req request, handle func(json.RawMessage) error, done func() bool) error {
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
func (w *Worker) Close() error {
	if w == nil || w.worker == nil {
		return nil
	}
	return w.worker.Close()
}

func runtimeWorkerRequestBatch(req request) []any {
	if !shouldChunkRuntimeRequest(req) {
		return []any{req}
	}
	requestID := fmt.Sprintf("runtime:%d", time.Now().UnixNano())
	events := []any{startRequest(req, requestID)}
	events = appendProjectIndexPreviousIndexBatches(events, req, requestID)
	events = append(events, request{
		ProtocolVersion: 2,
		Method:          req.Method,
		RequestID:       requestID,
		RequestKind:     "done",
	})
	return events
}

func shouldChunkRuntimeRequest(req request) bool {
	return req.Method == "indexProjectRuntime" &&
		req.PreviousIndex != nil &&
		(len(req.PreviousIndex.Definitions) > 0 || len(req.PreviousIndex.Sources) > 0)
}

func startRequest(req request, requestID string) request {
	start := req
	start.RequestID = requestID
	start.RequestKind = "start"
	start.PreviousDefinitions = nil
	start.PreviousSources = nil
	if start.PreviousIndex != nil {
		previous := *start.PreviousIndex
		previous.Definitions = nil
		previous.Sources = nil
		start.PreviousIndex = &previous
	}
	return start
}

func appendProjectIndexPreviousIndexBatches(events []any, req request, requestID string) []any {
	if req.PreviousIndex == nil {
		return events
	}
	for _, batch := range projectDefinitionBatches(req.PreviousIndex.Definitions, requestBatchSize) {
		events = append(events, request{
			ProtocolVersion:     2,
			Method:              req.Method,
			RequestID:           requestID,
			RequestKind:         "previousIndex:definitions",
			PreviousDefinitions: batch,
		})
	}
	for _, batch := range indexSourceFileBatches(req.PreviousIndex.Sources, requestBatchSize) {
		events = append(events, request{
			ProtocolVersion: 2,
			Method:          req.Method,
			RequestID:       requestID,
			RequestKind:     "previousIndex:sources",
			PreviousSources: batch,
		})
	}
	return events
}

func projectDefinitionBatches(values []store.ProjectDefinition, batchSize int) [][]store.ProjectDefinition {
	batches := [][]store.ProjectDefinition{}
	for offset := 0; offset < len(values); offset += batchSize {
		end := offset + batchSize
		if end > len(values) {
			end = len(values)
		}
		batches = append(batches, values[offset:end])
	}
	return batches
}

func indexSourceFileBatches(values []store.IndexSourceFile, batchSize int) [][]store.IndexSourceFile {
	batches := [][]store.IndexSourceFile{}
	for offset := 0; offset < len(values); offset += batchSize {
		end := offset + batchSize
		if end > len(values) {
			end = len(values)
		}
		batches = append(batches, values[offset:end])
	}
	return batches
}

func newNodeStreamWorker(name string, content []byte, scriptPath string) *nodeworker.Worker {
	options := []nodeworker.Option{nodeworker.WithMaxResponseBytes(maxResponseBytes)}
	if scriptPath != "" {
		options = append(options, nodeworker.WithScriptPath(scriptPath))
	}
	return nodeworker.New(nodeworker.Script{Name: name, Content: content}, options...)
}
