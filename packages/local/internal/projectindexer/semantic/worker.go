package semantic

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/store"
)

const (
	maxResponseBytes = 16 * 1024 * 1024
	producer         = "@crux/indexer/project-indexer"
	requestBatchSize = 128
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
	lastTimings []devtools.ProjectIndexPhaseTiming
}

type request struct {
	ProtocolVersion     int                                  `json:"protocolVersion,omitempty"`
	Method              string                               `json:"method"`
	RequestID           string                               `json:"requestId,omitempty"`
	RequestKind         string                               `json:"requestKind,omitempty"`
	Root                string                               `json:"root"`
	ConfigPath          string                               `json:"configPath,omitempty"`
	ProjectName         string                               `json:"projectName,omitempty"`
	SemanticBudget      *devtools.IndexPatchBudget           `json:"semanticBudget,omitempty"`
	PreviousIndex       *store.IndexData                     `json:"previousIndex,omitempty"`
	PreviousDefinitions []store.ProjectDefinition            `json:"previousIndexDefinitions,omitempty"`
	PreviousSources     []store.IndexSourceFile              `json:"previousIndexSources,omitempty"`
	Files               []string                             `json:"files,omitempty"`
	DependencyClosure   []string                             `json:"dependencyClosure,omitempty"`
	SourceProfile       *devtools.SemanticSourceProfile      `json:"sourceProfile,omitempty"`
	SourceProfileFiles  []devtools.SemanticSourceProfileFile `json:"sourceProfileFiles,omitempty"`
}

// New creates a semantic worker backed by project-semantic-indexer.mjs.
func New(options Options) *Worker {
	return &Worker{
		scriptPath: options.ScriptPath,
		worker:     newNodeStreamWorker("project-semantic-indexer", options.ScriptContent, options.ScriptPath),
	}
}

func (w *Worker) IndexProjectSemanticPatch(ctx context.Context, semanticRequest devtools.ProjectSemanticIndexRequest) (devtools.IndexPatch, error) {
	req := request{
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
		return devtools.IndexPatch{}, err
	}
	w.setLastTimings(timings)
	if len(patches) != 1 {
		return devtools.IndexPatch{}, fmt.Errorf("project semantic worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}

func (w *Worker) streamPatches(ctx context.Context, req request, budget devtools.IndexPatchBudget) ([]devtools.IndexPatch, []devtools.ProjectIndexPhaseTiming, error) {
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
		return nil, nil, err
	}
	patches, err := collector.Patches()
	if err != nil {
		return nil, nil, err
	}
	return patches, collector.Timings(), nil
}

func (w *Worker) streamRequest(ctx context.Context, req request, handle func(json.RawMessage) error, done func() bool) error {
	req.ProtocolVersion = 2
	requests := semanticWorkerRequestBatch(req)
	return nodeworker.StreamCallBatch(ctx, w.worker, requests, func(raw json.RawMessage) (bool, error) {
		if err := handle(raw); err != nil {
			return false, err
		}
		return done(), nil
	})
}

// Close shuts down the semantic worker process.
func (w *Worker) Close() error {
	if w == nil || w.worker == nil {
		return nil
	}
	return w.worker.Close()
}

// LastSemanticTimings returns diagnostic timing buckets from the latest semantic request.
func (w *Worker) LastSemanticTimings() []devtools.ProjectIndexPhaseTiming {
	if w == nil {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]devtools.ProjectIndexPhaseTiming(nil), w.lastTimings...)
}

func (w *Worker) setLastTimings(timings []devtools.ProjectIndexPhaseTiming) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.lastTimings = append([]devtools.ProjectIndexPhaseTiming(nil), timings...)
}

func semanticWorkerRequestBatch(req request) []any {
	if !shouldChunkSemanticRequest(req) {
		return []any{req}
	}
	requestID := fmt.Sprintf("semantic:%d", time.Now().UnixNano())
	events := []any{semanticWorkerStartRequest(req, requestID)}
	events = appendSemanticPreviousIndexBatches(events, req, requestID)
	events = appendSemanticSourceProfileBatches(events, req, requestID)
	events = append(events, request{
		ProtocolVersion: 2,
		Method:          req.Method,
		RequestID:       requestID,
		RequestKind:     "done",
	})
	return events
}

func shouldChunkSemanticRequest(req request) bool {
	return (req.SourceProfile != nil && len(req.SourceProfile.Files) > 0) ||
		(req.PreviousIndex != nil && (len(req.PreviousIndex.Definitions) > 0 || len(req.PreviousIndex.Sources) > 0))
}

func semanticWorkerStartRequest(req request, requestID string) request {
	start := req
	start.RequestID = requestID
	start.RequestKind = "start"
	start.PreviousDefinitions = nil
	start.PreviousSources = nil
	start.SourceProfileFiles = nil
	if start.PreviousIndex != nil {
		previous := *start.PreviousIndex
		previous.Definitions = nil
		previous.Sources = nil
		start.PreviousIndex = &previous
	}
	if start.SourceProfile != nil {
		profile := *start.SourceProfile
		profile.Files = nil
		start.SourceProfile = &profile
	}
	return start
}

func appendSemanticPreviousIndexBatches(events []any, req request, requestID string) []any {
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

func appendSemanticSourceProfileBatches(events []any, req request, requestID string) []any {
	if req.SourceProfile == nil {
		return events
	}
	for _, batch := range semanticSourceProfileFileBatches(req.SourceProfile.Files, requestBatchSize) {
		events = append(events, request{
			ProtocolVersion:    2,
			Method:             req.Method,
			RequestID:          requestID,
			RequestKind:        "sourceProfile:batch",
			SourceProfileFiles: batch,
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

func semanticSourceProfileFileBatches(values []devtools.SemanticSourceProfileFile, batchSize int) [][]devtools.SemanticSourceProfileFile {
	batches := [][]devtools.SemanticSourceProfileFile{}
	for offset := 0; offset < len(values); offset += batchSize {
		end := offset + batchSize
		if end > len(values) {
			end = len(values)
		}
		batches = append(batches, values[offset:end])
	}
	return batches
}
