package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"

	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/privacy"
	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/projectwatch"
	"github.com/use-crux/crux/packages/local/internal/runtimeartifact"
	"github.com/use-crux/crux/packages/local/internal/startup"
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

func discoveryIsolatedRuntimeArtifactGenerator(generate RuntimeArtifactGenerator, service *devtools.Service) RuntimeArtifactGenerator {
	return func(ctx context.Context, root string, definitions []store.ProjectDefinition) error {
		release, err := service.AcquireContendedCompilerCapacity(ctx)
		if err != nil {
			return err
		}
		defer release()
		return generate(ctx, root, definitions)
	}
}

func (d *DevServer) runProjectIndexLifecycle() {
	root := d.projectRoot
	if root == "" || d.Devtools == nil {
		d.startup.Update("project-index", "Indexing project", startup.Degraded, []startup.Diagnostic{{
			ID: "project-index-unavailable", Code: "PROJECT_INDEX_UNAVAILABLE", Severity: "warning",
			Message: "Project indexing is unavailable because the project root could not be resolved.",
		}})
		d.startup.Update("runtime-artifacts", "Generating runtime artifacts", startup.Degraded, nil)
		return
	}
	baselineDone := make(chan struct{})
	baselineOK := false
	runner := projectwatch.NewRunner(func(runCtx context.Context, run projectwatch.Run) {
		select {
		case <-baselineDone:
		case <-runCtx.Done():
			return
		}
		if !baselineOK {
			baselineOK = d.refreshProjectIndex(runCtx, root)
			return
		}
		d.refreshProjectIndexDelta(runCtx, root, run)
	})
	watcher, err := projectwatch.New(projectwatch.Options{
		Root: root,
		OnDelta: func(delta projectwatch.Delta) {
			runner.Enqueue(d.ctx, delta)
		},
	})
	if err != nil {
		d.logger.Warn("project index watcher unavailable", "error", err)
		_ = d.refreshProjectIndex(d.ctx, root)
		return
	}
	watchReady := make(chan error, 1)
	watchDone := make(chan error, 1)
	go func() {
		watchDone <- watcher.RunReady(d.ctx, func(err error) { watchReady <- err })
	}()
	if err := <-watchReady; err != nil {
		d.logger.Warn("project index watcher unavailable", "error", err)
		_ = d.refreshProjectIndex(d.ctx, root)
		return
	}
	d.logger.Info("project index watcher started", "root", root)
	baselineOK = d.refreshProjectIndex(d.ctx, root)
	close(baselineDone)
	if err := <-watchDone; err != nil && d.ctx.Err() == nil {
		d.logger.Warn("project index watcher stopped", "error", err)
	}
	runner.Wait()
}

func (d *DevServer) refreshProjectIndex(ctx context.Context, root string) bool {
	d.startup.Update("project-index", "Indexing project", startup.Active, nil)
	if err := privacy.InvalidateGenerated(root); err != nil {
		d.logger.Warn("privacy policy invalidation failed", "error", err)
	}
	index, err := d.Devtools.ReindexProjectWithOptions(ctx, root, "", "", devtools.ProjectReindexOptions{
		Semantic: devtools.ProjectSemanticBackground,
	})
	if err != nil {
		d.logger.Warn("project index startup reindex failed", "error", err)
		d.startup.Update("project-index", "Indexing project", startup.Degraded, []startup.Diagnostic{{
			ID: "project-index-startup-failed", Code: "PROJECT_INDEX_STARTUP_FAILED", Severity: "warning",
			Message: err.Error(), Remediation: "Fix the reported index error; the active watcher will retry after the next source change.",
		}})
		d.startup.Update("runtime-artifacts", "Generating runtime artifacts", startup.Degraded, nil)
		return false
	}
	// The source/AST Project Index is now usable. Runtime enrichment and
	// generated artifacts have their own startup task and must not leave the
	// Project Index gate Active when either optional phase degrades.
	d.startup.Update("project-index", "Indexing project", startup.Succeeded, nil)
	enrich := d.enrichProjectRuntime
	if enrich == nil {
		enrich = func(ctx context.Context, root string, previous store.IndexData) (store.IndexData, error) {
			return d.Devtools.EnrichProjectRuntime(ctx, root, "", "", previous)
		}
	}
	index, err = enrich(ctx, root, index)
	if err != nil {
		d.logger.Warn("project runtime enrichment failed", "error", err)
		d.startup.Update("runtime-artifacts", "Generating runtime artifacts", startup.Degraded, []startup.Diagnostic{runtimeArtifactStartupDiagnostic(err)})
		return true
	}
	d.startup.Update("runtime-artifacts", "Generating runtime artifacts", startup.Active, nil)
	if d.runtimeArtifacts != nil {
		if err := d.runtimeArtifacts(ctx, root, index.Definitions); err != nil {
			d.logger.Warn("runtime artifact startup generation failed", "error", err)
			d.startup.Update("runtime-artifacts", "Generating runtime artifacts", startup.Degraded, []startup.Diagnostic{runtimeArtifactStartupDiagnostic(err)})
			return true
		}
	}
	d.startup.Update("runtime-artifacts", "Generating runtime artifacts", startup.Succeeded, nil)
	return true
}

func (d *DevServer) refreshProjectIndexDelta(ctx context.Context, root string, run projectwatch.Run) {
	if err := privacy.InvalidateGenerated(root); err != nil {
		d.logger.Warn("privacy policy invalidation failed", "error", err, "watchRunId", run.ID)
		return
	}
	index, err := d.Devtools.ReindexProjectIncrementalWithOptions(ctx, root, "", "", run.Delta.Files, run.Delta.DeletedFiles, devtools.ProjectReindexOptions{
		Semantic: devtools.ProjectSemanticBackground,
		Watch: devtools.ProjectWatchRunOptions{
			RunID:                   run.ID,
			DeltaBatchCount:         run.Queue.DeltaBatchCount,
			CoalescedWhileRunning:   run.Queue.CoalescedWhileRunning,
			PendingRunReplacedCount: run.Queue.PendingRunReplacedCount,
		},
	})
	if err != nil {
		d.logger.Warn("project index incremental reindex failed", "error", err, "watchRunId", run.ID, "files", len(run.Delta.Files), "deletedFiles", len(run.Delta.DeletedFiles))
		return
	}
	index, err = d.Devtools.EnrichProjectRuntime(ctx, root, "", "", index)
	if err != nil {
		d.logger.Warn("project runtime enrichment failed", "error", err, "watchRunId", run.ID)
		d.startup.Update("runtime-artifacts", "Generating runtime artifacts", startup.Degraded, []startup.Diagnostic{runtimeArtifactStartupDiagnostic(err)})
		return
	}
	if d.runtimeArtifacts != nil {
		d.startup.Update("runtime-artifacts", "Generating runtime artifacts", startup.Active, nil)
		if err := d.runtimeArtifacts(ctx, root, index.Definitions); err != nil {
			d.logger.Warn("runtime artifact watch generation failed", "error", err, "watchRunId", run.ID, "files", len(run.Delta.Files), "deletedFiles", len(run.Delta.DeletedFiles))
			d.startup.Update("runtime-artifacts", "Generating runtime artifacts", startup.Degraded, []startup.Diagnostic{runtimeArtifactStartupDiagnostic(err)})
			return
		}
		d.startup.Update("runtime-artifacts", "Generating runtime artifacts", startup.Succeeded, nil)
	}
}

func runtimeArtifactStartupDiagnostic(err error) startup.Diagnostic {
	diagnostic := startup.Diagnostic{
		ID:       "runtime-artifacts-startup-failed",
		Code:     "RUNTIME_ARTIFACTS_STARTUP_FAILED",
		Severity: "warning",
		Message:  "Crux could not refresh the generated Runtime files. The last working files remain active.",
	}
	var workerErr *runtimeartifact.WorkerError
	if !errors.As(err, &workerErr) || len(workerErr.Findings) == 0 {
		return diagnostic
	}
	diagnostic.Code = workerErr.Code
	if diagnostic.Code == "" {
		diagnostic.Code = "RUNTIME_ARTIFACT_GENERATION_FAILED"
	}
	diagnostic.Children = make([]startup.Diagnostic, 0, len(workerErr.Findings))
	for index, finding := range workerErr.Findings {
		child := startup.Diagnostic{
			ID:             fmt.Sprintf("runtime-artifact-finding-%03d-%s", index, finding.Code),
			Code:           finding.Code,
			Severity:       "warning",
			Category:       finding.Category,
			FeatureKind:    finding.FeatureKind,
			FeatureID:      finding.FeatureID,
			Arm:            finding.Arm,
			Source:         finding.Source,
			Message:        finding.Summary,
			Reason:         finding.Reason,
			WhatStillWorks: finding.WhatStillWorks,
			Docs:           finding.Docs,
		}
		if finding.Remediation != "" {
			child.Remediation = finding.Remediation + " Crux dev will retry automatically after the next relevant save."
		}
		diagnostic.Children = append(diagnostic.Children, child)
	}
	first := workerErr.Findings[0]
	diagnostic.Message = first.Summary
	if len(workerErr.Findings) > 1 {
		diagnostic.Message = fmt.Sprintf("%d issues · %s", len(workerErr.Findings), first.Summary)
	}
	diagnostic.Remediation = diagnostic.Children[0].Remediation
	return diagnostic
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
