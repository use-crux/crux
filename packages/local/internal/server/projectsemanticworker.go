package server

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

// ProjectSemanticWorker runs semantic Project Index enrichment through its own
// V2 NDJSON worker process.
type ProjectSemanticWorker struct {
	scriptPath  string
	worker      *nodeworker.Worker
	mu          sync.Mutex
	lastTimings []devtools.ProjectIndexPhaseTiming
}

// NewProjectSemanticWorker creates a semantic worker backed by project-semantic-indexer.mjs.
func NewProjectSemanticWorker(scriptPath string) *ProjectSemanticWorker {
	return &ProjectSemanticWorker{
		scriptPath: scriptPath,
		worker:     newNodeStreamWorker("project-semantic-indexer", embeddedProjectSemanticIndexer, scriptPath),
	}
}

func (w *ProjectSemanticWorker) IndexProjectSemanticPatch(ctx context.Context, request devtools.ProjectSemanticIndexRequest) (devtools.IndexPatch, error) {
	req := projectIndexRequest{
		Method:         "indexProjectSemantic",
		Root:           request.Root,
		ConfigPath:     request.ConfigPath,
		ProjectName:    request.ProjectName,
		SemanticBudget: &request.Budget,
		PreviousIndex:  request.PreviousIndex,
		Files:          request.Files,
		SourceProfile:  request.SourceProfile,
	}
	if len(request.DependencyClosure) > 0 {
		req.DependencyClosure = request.DependencyClosure
	}
	patches, timings, err := w.streamPatches(ctx, req, request.Budget)
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	w.setLastTimings(timings)
	if len(patches) != 1 {
		return devtools.IndexPatch{}, fmt.Errorf("project semantic worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}

func (w *ProjectSemanticWorker) streamPatches(ctx context.Context, req projectIndexRequest, budget devtools.IndexPatchBudget) ([]devtools.IndexPatch, []devtools.ProjectIndexPhaseTiming, error) {
	collector := devtools.NewProjectIndexPatchStreamCollector(devtools.ProjectIndexPatchStreamOptions{
		Root:             req.Root,
		Budget:           budget,
		MaxBytes:         projectIndexWorkerMaxResponseBytes,
		MaxFactsPerBatch: projectIndexWorkerMaxFactsPerBatch(req.Method),
		Producer:         projectIndexWorkerProducer,
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

func (w *ProjectSemanticWorker) streamRequest(ctx context.Context, req projectIndexRequest, handle func(json.RawMessage) error, done func() bool) error {
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
func (w *ProjectSemanticWorker) Close() error {
	if w == nil || w.worker == nil {
		return nil
	}
	return w.worker.Close()
}

// LastSemanticTimings returns diagnostic timing buckets from the latest semantic request.
func (w *ProjectSemanticWorker) LastSemanticTimings() []devtools.ProjectIndexPhaseTiming {
	if w == nil {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]devtools.ProjectIndexPhaseTiming(nil), w.lastTimings...)
}

func (w *ProjectSemanticWorker) setLastTimings(timings []devtools.ProjectIndexPhaseTiming) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.lastTimings = append([]devtools.ProjectIndexPhaseTiming(nil), timings...)
}

func semanticWorkerRequestBatch(req projectIndexRequest) []any {
	if !shouldChunkSemanticRequest(req) {
		return []any{req}
	}
	requestID := fmt.Sprintf("semantic:%d", time.Now().UnixNano())
	events := []any{semanticWorkerStartRequest(req, requestID)}
	events = appendSemanticPreviousIndexBatches(events, req, requestID)
	events = appendSemanticSourceProfileBatches(events, req, requestID)
	events = append(events, projectIndexRequest{
		ProtocolVersion: 2,
		Method:          req.Method,
		RequestID:       requestID,
		RequestKind:     "done",
	})
	return events
}

func shouldChunkSemanticRequest(req projectIndexRequest) bool {
	return (req.SourceProfile != nil && len(req.SourceProfile.Files) > 0) ||
		(req.PreviousIndex != nil && (len(req.PreviousIndex.Definitions) > 0 || len(req.PreviousIndex.Sources) > 0))
}

func semanticWorkerStartRequest(req projectIndexRequest, requestID string) projectIndexRequest {
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

func appendSemanticPreviousIndexBatches(events []any, req projectIndexRequest, requestID string) []any {
	if req.PreviousIndex == nil {
		return events
	}
	for _, batch := range projectDefinitionBatches(req.PreviousIndex.Definitions, semanticWorkerRequestBatchSize) {
		events = append(events, projectIndexRequest{
			ProtocolVersion:     2,
			Method:              req.Method,
			RequestID:           requestID,
			RequestKind:         "previousIndex:definitions",
			PreviousDefinitions: batch,
		})
	}
	for _, batch := range indexSourceFileBatches(req.PreviousIndex.Sources, semanticWorkerRequestBatchSize) {
		events = append(events, projectIndexRequest{
			ProtocolVersion: 2,
			Method:          req.Method,
			RequestID:       requestID,
			RequestKind:     "previousIndex:sources",
			PreviousSources: batch,
		})
	}
	return events
}

func appendSemanticSourceProfileBatches(events []any, req projectIndexRequest, requestID string) []any {
	if req.SourceProfile == nil {
		return events
	}
	for _, batch := range semanticSourceProfileFileBatches(req.SourceProfile.Files, semanticWorkerRequestBatchSize) {
		events = append(events, projectIndexRequest{
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

const semanticWorkerRequestBatchSize = 128
