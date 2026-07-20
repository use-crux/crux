package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"

	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/privacy"
	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/projectwatch"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func privacyGuardedRuntimeArtifactGenerator(generate RuntimeArtifactGenerator) RuntimeArtifactGenerator {
	return func(ctx context.Context, root string, definitions []store.ProjectDefinition) error {
		if err := privacy.InvalidateGenerated(root); err != nil {
			return err
		}
		return generate(ctx, root, definitions)
	}
}

func startProjectIndexWatcher(ctx context.Context, logger *slog.Logger, root string, devtoolsSvc *devtools.Service, runtimeArtifacts RuntimeArtifactGenerator) {
	runner := projectwatch.NewRunner(func(runCtx context.Context, run projectwatch.Run) {
		if err := privacy.InvalidateGenerated(root); err != nil {
			logger.Warn("privacy policy invalidation failed", "error", err, "watchRunId", run.ID)
			return
		}
		index, err := devtoolsSvc.ReindexProjectIncrementalWithOptions(runCtx, root, "", "", run.Delta.Files, run.Delta.DeletedFiles, devtools.ProjectReindexOptions{
			Semantic: devtools.ProjectSemanticBackground,
			Watch: devtools.ProjectWatchRunOptions{
				RunID:                   run.ID,
				DeltaBatchCount:         run.Queue.DeltaBatchCount,
				CoalescedWhileRunning:   run.Queue.CoalescedWhileRunning,
				PendingRunReplacedCount: run.Queue.PendingRunReplacedCount,
			},
		})
		if err != nil {
			logger.Warn("project index incremental reindex failed", "error", err, "watchRunId", run.ID, "files", len(run.Delta.Files), "deletedFiles", len(run.Delta.DeletedFiles))
			return
		}
		if runtimeArtifacts != nil {
			if err := runtimeArtifacts(runCtx, root, index.Definitions); err != nil {
				logger.Warn("runtime artifact watch generation failed", "error", err, "watchRunId", run.ID, "files", len(run.Delta.Files), "deletedFiles", len(run.Delta.DeletedFiles))
			}
		}
	})
	watcher, err := projectwatch.New(projectwatch.Options{
		Root: root,
		OnDelta: func(delta projectwatch.Delta) {
			runner.Enqueue(ctx, delta)
		},
	})
	if err != nil {
		logger.Warn("project index watcher unavailable", "error", err)
		return
	}
	logger.Info("project index watcher started", "root", root)
	if err := watcher.Run(ctx); err != nil {
		logger.Warn("project index watcher stopped", "error", err)
	}
	runner.Wait()
}

type runtimeArtifactWorker interface {
	GenerateRuntimeArtifacts(ctx context.Context, root string, definitions []store.ProjectDefinition) (json.RawMessage, error)
}

func newRuntimeArtifactGeneratorForDev(projectIndexerScript string, logger *slog.Logger, stderr io.Writer) (RuntimeArtifactGenerator, func() error) {
	worker := assets.NewEmbeddedProjectIndexer(
		projectIndexerScript,
		workerproc.WithLogger(logger),
		workerproc.WithStderr(stderr),
	)
	return runtimeArtifactGeneratorForWorker(worker), worker.Close
}

func runtimeArtifactGeneratorForWorker(worker runtimeArtifactWorker) RuntimeArtifactGenerator {
	return func(ctx context.Context, root string, definitions []store.ProjectDefinition) error {
		return generateRuntimeArtifactsWithWorker(ctx, root, definitions, worker)
	}
}

func generateRuntimeArtifactsWithWorker(ctx context.Context, root string, definitions []store.ProjectDefinition, worker runtimeArtifactWorker) error {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, runtimeArtifactGenerationTimeout)
		defer cancel()
	}
	_, err := worker.GenerateRuntimeArtifacts(ctx, root, definitions)
	return err
}
