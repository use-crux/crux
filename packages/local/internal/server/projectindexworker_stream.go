package server

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

const (
	projectIndexStaticFallbackTimeout              = 30 * time.Second
	projectIndexWorkerRequestBatchSize             = 128
	projectIndexSyntaxRecordRequestBatchMaxRecords = 32
	projectIndexSyntaxRecordRequestBatchMaxBytes   = 8 * 1024 * 1024
)

func (w *ProjectIndexWorker) sourceOnlyArtifactFallback(ctx context.Context, req projectIndexRequest, artifact devtools.ProjectIndexArtifactKind, cause error) (json.RawMessage, error) {
	timeout := projectIndexStaticFallbackTimeout
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining < 0 {
			remaining = 0
		}
		if remaining < timeout {
			timeout = remaining
		}
	}

	fallbackCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req.ResolutionMode = "source-only"
	resp, err := w.streamArtifact(fallbackCtx, req, artifact)
	if err != nil {
		return nil, fmt.Errorf("project index source-only fallback after worker failure (%s): %w", cause.Error(), err)
	}
	return resp, nil
}

func (w *ProjectIndexWorker) streamPatches(ctx context.Context, req projectIndexRequest, budget devtools.IndexPatchBudget) ([]devtools.IndexPatch, error) {
	collector, err := w.streamCollector(ctx, req, budget)
	if err != nil {
		return nil, err
	}
	return collector.Patches()
}

func (w *ProjectIndexWorker) streamCollector(ctx context.Context, req projectIndexRequest, budget devtools.IndexPatchBudget) (*devtools.ProjectIndexPatchStreamCollector, error) {
	collector := devtools.NewProjectIndexPatchStreamCollector(devtools.ProjectIndexPatchStreamOptions{
		Root:             req.Root,
		Budget:           budget,
		MaxBytes:         projectIndexWorkerMaxResponseBytes,
		MaxFactsPerBatch: projectIndexWorkerMaxFactsPerBatch(req.Method),
		Producer:         projectIndexWorkerProducer,
	})
	err := w.streamPatchRequest(ctx, req, collector.Handle, func() bool {
		if req.Method == "indexProjectIncremental" {
			return collector.HasIncrementalReport()
		}
		return collector.CompletedPatchCount() >= 1
	})
	if err != nil {
		return nil, err
	}
	return collector, nil
}

func (w *ProjectIndexWorker) streamArtifact(ctx context.Context, req projectIndexRequest, artifact devtools.ProjectIndexArtifactKind) (json.RawMessage, error) {
	collector := devtools.NewProjectIndexArtifactStreamCollector(devtools.ProjectIndexArtifactStreamOptions{
		Root:     req.Root,
		Artifact: artifact,
		MaxBytes: projectIndexWorkerMaxResponseBytes,
	})
	result, err := w.streamRequest(ctx, req, collector.Handle)
	if err != nil {
		return nil, err
	}
	if result.ExitErr != nil {
		if result.Stderr != "" {
			return nil, fmt.Errorf("project index worker exited: %w: %s", result.ExitErr, result.Stderr)
		}
		return nil, fmt.Errorf("project index worker exited: %w", result.ExitErr)
	}
	return collector.Payload()
}

func (w *ProjectIndexWorker) streamRequest(ctx context.Context, req projectIndexRequest, handle func(json.RawMessage) error) (nodeworker.StreamResult, error) {
	req.ProtocolVersion = 2
	data, err := json.Marshal(req)
	if err != nil {
		return nodeworker.StreamResult{}, fmt.Errorf("marshal streamed project index request: %w", err)
	}
	data = append(data, '\n')
	return nodeworker.Stream(ctx, nodeworker.OneShot{
		Script: nodeworker.Script{
			Name:    "project-indexer",
			Content: embeddedProjectIndexer,
		},
		ScriptPath:   w.scriptPath,
		Input:        data,
		MaxLineBytes: projectIndexWorkerMaxResponseBytes,
	}, handle)
}

func (w *ProjectIndexWorker) streamPatchRequest(ctx context.Context, req projectIndexRequest, handle func(json.RawMessage) error, done func() bool) error {
	req.ProtocolVersion = 2
	requests, err := projectIndexWorkerRequestBatch(req)
	if err != nil {
		return err
	}
	return nodeworker.StreamCallBatch(ctx, w.worker, requests, func(raw json.RawMessage) (bool, error) {
		if err := handle(raw); err != nil {
			return false, err
		}
		return done(), nil
	})
}

func projectIndexWorkerRequestBatch(req projectIndexRequest) ([]any, error) {
	if !shouldChunkProjectIndexRequest(req) {
		return []any{req}, nil
	}
	requestID := projectIndexWorkerRequestID()
	events := []any{projectIndexWorkerStartRequest(req, requestID)}
	events = appendProjectIndexPreviousIndexBatches(events, req, requestID)
	var err error
	events, err = appendProjectIndexSyntaxRecordBatches(events, req, requestID)
	if err != nil {
		return nil, err
	}
	events = append(events, projectIndexRequest{
		ProtocolVersion: 2,
		Method:          req.Method,
		RequestID:       requestID,
		RequestKind:     "done",
	})
	return events, nil
}

func projectIndexWorkerRequestID() string {
	return fmt.Sprintf("index:%d", time.Now().UnixNano())
}

func shouldChunkProjectIndexRequest(req projectIndexRequest) bool {
	if req.Method == "indexProjectAstFromSyntaxRecords" {
		return true
	}
	return req.Method == "indexProjectIncremental" &&
		req.PreviousIndex != nil &&
		(len(req.PreviousIndex.Definitions) > 0 || len(req.PreviousIndex.Sources) > 0)
}

func projectIndexWorkerStartRequest(req projectIndexRequest, requestID string) projectIndexRequest {
	start := req
	start.RequestID = requestID
	start.RequestKind = "start"
	start.PreviousDefinitions = nil
	start.PreviousSources = nil
	start.SyntaxRecords = nil
	start.SyntaxRecordsBatch = nil
	if start.PreviousIndex != nil {
		previous := *start.PreviousIndex
		previous.Definitions = nil
		previous.Sources = nil
		start.PreviousIndex = &previous
	}
	return start
}

func appendProjectIndexPreviousIndexBatches(events []any, req projectIndexRequest, requestID string) []any {
	if req.PreviousIndex == nil {
		return events
	}
	for _, batch := range projectDefinitionBatches(req.PreviousIndex.Definitions, projectIndexWorkerRequestBatchSize) {
		events = append(events, projectIndexRequest{
			ProtocolVersion:     2,
			Method:              req.Method,
			RequestID:           requestID,
			RequestKind:         "previousIndex:definitions",
			PreviousDefinitions: batch,
		})
	}
	for _, batch := range indexSourceFileBatches(req.PreviousIndex.Sources, projectIndexWorkerRequestBatchSize) {
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

func appendProjectIndexSyntaxRecordBatches(events []any, req projectIndexRequest, requestID string) ([]any, error) {
	if req.Method != "indexProjectAstFromSyntaxRecords" {
		return events, nil
	}
	batches, err := projectIndexSyntaxRecordBatches(req.SyntaxRecords)
	if err != nil {
		return nil, err
	}
	for _, batch := range batches {
		events = append(events, projectIndexRequest{
			ProtocolVersion:    2,
			Method:             req.Method,
			RequestID:          requestID,
			RequestKind:        "syntaxRecords",
			SyntaxRecordsBatch: batch,
		})
	}
	return events, nil
}

func projectIndexSyntaxRecordBatches(records []json.RawMessage) ([][]json.RawMessage, error) {
	if len(records) == 0 {
		return nil, nil
	}

	batches := make([][]json.RawMessage, 0, (len(records)/projectIndexSyntaxRecordRequestBatchMaxRecords)+1)
	chunker := newProjectIndexSyntaxRecordChunker(func(batch []json.RawMessage) error {
		batches = append(batches, append([]json.RawMessage(nil), batch...))
		return nil
	})
	for _, record := range records {
		if err := chunker.Add(record); err != nil {
			return nil, err
		}
	}
	if err := chunker.Flush(); err != nil {
		return nil, err
	}
	return batches, nil
}

func projectIndexWorkerMaxFactsPerBatch(method string) int {
	switch method {
	case "indexProjectSemantic":
		return 100
	case "indexProjectAst", "indexProjectAstFromSyntaxRecords", "indexProjectIncremental":
		return 200
	default:
		return 100
	}
}
