package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindexer/syntax"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

func (w *Worker) indexProjectAstPatchFromNativeSyntaxRecordStream(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	plan devtools.ProjectStaticSyntaxPlan,
	parser syntax.StreamParser,
) (devtools.IndexPatch, ProjectIndexAstTiming, error) {
	req := projectIndexRequest{
		ProtocolVersion: 2,
		Method:          "indexProjectAstFromSyntaxRecords",
		Root:            root,
		ConfigPath:      configPath,
		ProjectName:     projectName,
		ResolutionMode:  "source-only",
		SyntaxFrontend:  projectSyntaxFrontendIdentity(plan),
		StaticCacheHits: plan.CacheEntries,
	}
	collector := devtools.NewProjectIndexPatchStreamCollector(devtools.ProjectIndexPatchStreamOptions{
		Root:             req.Root,
		Budget:           devtools.IndexPatchBudget{},
		MaxBytes:         workerMaxResponseBytes,
		MaxFactsPerBatch: maxFactsPerBatch(req.Method),
		Producer:         workerProducer,
	})
	timing, err := w.streamNativeSyntaxRecordsToProjectIndexer(ctx, req, plan, parser, collector.Handle, func() bool {
		return collector.CompletedPatchCount() >= 1
	})
	if err != nil {
		return devtools.IndexPatch{}, timing, err
	}
	patches, err := collector.Patches()
	if err != nil {
		return devtools.IndexPatch{}, timing, err
	}
	if len(patches) != 1 {
		return devtools.IndexPatch{}, timing, fmt.Errorf("project ast syntax-record worker returned %d patches, want 1", len(patches))
	}
	timing.NodeTimings = collector.Timings()
	return patches[0], timing, nil
}

func (w *Worker) streamNativeSyntaxRecordsToProjectIndexer(
	ctx context.Context,
	req projectIndexRequest,
	plan devtools.ProjectStaticSyntaxPlan,
	parser syntax.StreamParser,
	handle func(json.RawMessage) error,
	done func() bool,
) (ProjectIndexAstTiming, error) {
	requestID := requestID()
	parseRequests := projectSyntaxParseRequestsFromPlan(plan)
	var timing ProjectIndexAstTiming
	var sendDoneAt time.Time
	err := nodeworker.StreamCallSession(ctx, w.worker, func(send nodeworker.StreamSender) error {
		if err := send(startRequest(req, requestID)); err != nil {
			return err
		}
		chunker := newProjectIndexSyntaxRecordChunker(func(records []json.RawMessage) error {
			timing.ChunkCount++
			chunkBytes := 0
			for _, record := range records {
				chunkBytes += len(record)
			}
			if chunkBytes > timing.MaxChunkBytes {
				timing.MaxChunkBytes = chunkBytes
			}
			return send(syntax.RecordBatchRequestLine(req.Method, requestID, records))
		})
		parseStarted := time.Now()
		if err := parser.ParseFilesStream(ctx, parseRequests, func(_ int, record json.RawMessage) error {
			timing.RecordCount++
			timing.RecordBytes += len(record)
			return chunker.Add(record)
		}); err != nil {
			return err
		}
		if err := chunker.Flush(); err != nil {
			return err
		}
		if err := send(projectIndexRequest{
			ProtocolVersion: 2,
			Method:          req.Method,
			RequestID:       requestID,
			RequestKind:     "done",
		}); err != nil {
			return err
		}
		timing.NativeParseAndForwardMs = elapsedMs(parseStarted)
		sendDoneAt = time.Now()
		return nil
	}, func(raw json.RawMessage) (bool, error) {
		if err := handle(raw); err != nil {
			return false, err
		}
		return done(), nil
	})
	if !sendDoneAt.IsZero() {
		timing.NodeProjectionMs = elapsedMs(sendDoneAt)
	}
	return timing, err
}

func projectSyntaxFrontendIdentity(plan devtools.ProjectStaticSyntaxPlan) *devtools.SyntaxFrontend {
	if plan.SyntaxFrontend.Name == "" && plan.SyntaxFrontend.Version == "" {
		return nil
	}
	return &plan.SyntaxFrontend
}
