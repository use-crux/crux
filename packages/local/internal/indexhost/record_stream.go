package indexhost

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/indexhost/indexwire"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/syntax"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/syntax/record"
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/syntax/stream"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

func (w *Worker) indexProjectAstPatchFromNativeSyntaxRecordStream(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	plan projectindex.ProjectStaticSyntaxPlan,
	parser syntax.StreamParser,
) (projectindex.IndexPatch, ProjectIndexAstTiming, error) {
	req := indexwire.Request{
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
		MaxBytes:         workerMaxResponseBytes,
		MaxFactsPerBatch: indexwire.MaxFactsPerBatch(req.Method),
		Producer:         workerProducer,
	})
	streamTiming, err := syntaxstream.Stream(ctx, w.worker, req, plan, parser, collector.Handle, func() bool {
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

func astTimingFromSyntaxStream(timing syntaxstream.Timing) ProjectIndexAstTiming {
	return ProjectIndexAstTiming{
		NativeParseAndForwardMs: timing.ParseAndForwardMs,
		NodeProjectionMs:        timing.ProjectionMs,
		RecordCount:             timing.RecordCount,
		RecordBytes:             timing.RecordBytes,
		ChunkCount:              timing.ChunkCount,
		MaxChunkBytes:           timing.MaxChunkBytes,
	}
}
