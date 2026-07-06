package workers

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend/record"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend/stream"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
)

func (w *Bundle) indexProjectAstPatchFromNativeSyntaxRecordStream(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	plan projectindex.ProjectStaticSyntaxPlan,
	parser frontend.StreamParser,
) (projectindex.IndexPatch, ProjectIndexAstTiming, error) {
	req := requestwire.Request{
		ProtocolVersion: 2,
		Method:          "indexProjectAstFromSyntaxRecords",
		Root:            root,
		ConfigPath:      configPath,
		ProjectName:     projectName,
		ResolutionMode:  "source-only",
		SyntaxFrontend:  record.Frontend(plan),
		StaticCacheHits: plan.CacheEntries,
	}
	collector := projectindex.NewProjectIndexPatchStreamCollector(projectindex.ProjectIndexPatchStreamOptions{
		Root:             req.Root,
		Budget:           projectindex.IndexPatchBudget{},
		MaxBytes:         workerMaxResponseStreamBytes,
		MaxFactsPerBatch: requestwire.MaxFactsPerBatch(req.Method),
		Producer:         workerProducer,
	})
	streamTiming, err := frontendstream.Stream(ctx, w.worker, req, plan, parser, collector.Handle, func() bool {
		return collector.CompletedPatchCount() >= 1
	})
	timing := astTimingFromSyntaxStream(streamTiming)
	if err != nil {
		return projectindex.IndexPatch{}, timing, err
	}
	patches, err := collector.Patches()
	if err != nil {
		return projectindex.IndexPatch{}, timing, err
	}
	if len(patches) != 1 {
		return projectindex.IndexPatch{}, timing, fmt.Errorf("project ast syntax-record worker returned %d patches, want 1", len(patches))
	}
	timing.NodeTimings = collector.Timings()
	return patches[0], timing, nil
}

func astTimingFromSyntaxStream(timing frontendstream.Timing) ProjectIndexAstTiming {
	return ProjectIndexAstTiming{
		NativeParseAndForwardMs: timing.ParseAndForwardMs,
		NodeProjectionMs:        timing.ProjectionMs,
		RecordCount:             timing.RecordCount,
		RecordBytes:             timing.RecordBytes,
		ChunkCount:              timing.ChunkCount,
		MaxChunkBytes:           timing.MaxChunkBytes,
	}
}
