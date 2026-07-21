// Package host connects the filesystem watcher to the canonical Project Index
// devtools service. Dev server and editor hosts share this exact wiring.
package host

import (
	"context"
	"log/slog"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/privacy"
	"github.com/use-crux/crux/packages/local/internal/projectwatch"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// RuntimeArtifactGenerator refreshes generated runtime files after an index run.
type RuntimeArtifactGenerator func(context.Context, string, []store.ProjectDefinition) error

// Options configures a watcher hosted by a long-running local process.
type Options struct {
	Root             string
	Devtools         *devtools.Service
	RuntimeArtifacts RuntimeArtifactGenerator
}

// Start begins watching until ctx is cancelled. Watcher construction errors
// are returned synchronously; incremental indexing failures are logged and the
// watcher remains live for later changes.
func Start(ctx context.Context, options Options) error {
	runner := projectwatch.NewRunner(func(runCtx context.Context, run projectwatch.Run) {
		if err := privacy.InvalidateGenerated(options.Root); err != nil {
			slog.Warn("privacy policy invalidation failed", "error", err, "watchRunId", run.ID)
			return
		}
		index, err := options.Devtools.ReindexProjectIncrementalWithOptions(
			runCtx,
			options.Root,
			"",
			"",
			run.Delta.Files,
			run.Delta.DeletedFiles,
			devtools.ProjectReindexOptions{
				Semantic: devtools.ProjectSemanticBackground,
				Watch: devtools.ProjectWatchRunOptions{
					RunID:                   run.ID,
					DeltaBatchCount:         run.Queue.DeltaBatchCount,
					CoalescedWhileRunning:   run.Queue.CoalescedWhileRunning,
					PendingRunReplacedCount: run.Queue.PendingRunReplacedCount,
				},
			},
		)
		if err != nil {
			slog.Warn(
				"project index incremental reindex failed",
				"error", err,
				"watchRunId", run.ID,
				"files", len(run.Delta.Files),
				"deletedFiles", len(run.Delta.DeletedFiles),
			)
			return
		}
		if options.RuntimeArtifacts != nil {
			if err := options.RuntimeArtifacts(runCtx, options.Root, index.Definitions); err != nil {
				slog.Warn(
					"runtime artifact watch generation failed",
					"error", err,
					"watchRunId", run.ID,
					"files", len(run.Delta.Files),
					"deletedFiles", len(run.Delta.DeletedFiles),
				)
			}
		}
	})
	watcher, err := projectwatch.New(projectwatch.Options{
		Root: options.Root,
		OnDelta: func(delta projectwatch.Delta) {
			runner.Enqueue(ctx, delta)
		},
	})
	if err != nil {
		return err
	}
	go func() {
		slog.Info("project index watcher started", "root", options.Root)
		if err := watcher.Run(ctx); err != nil {
			slog.Warn("project index watcher stopped", "error", err)
		}
	}()
	return nil
}
