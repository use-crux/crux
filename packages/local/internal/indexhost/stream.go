package indexhost

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/indexhost/client"
	"github.com/use-crux/crux/packages/local/internal/indexhost/indexwire"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

func (w *Worker) indexHost() client.Client {
	return client.Client{
		Name:          "project-indexer",
		ScriptContent: w.scriptContent,
		ScriptPath:    w.scriptPath,
		Worker:        w.worker,
		MaxBytes:      workerMaxResponseBytes,
		Producer:      workerProducer,
	}
}

func (w *Worker) sourceOnlyArtifactFallback(ctx context.Context, req indexwire.Request, artifact projectindex.ProjectIndexArtifactKind, cause error) (json.RawMessage, error) {
	return w.indexHost().SourceOnlyArtifactFallback(ctx, req, artifact, cause)
}

func (w *Worker) streamPatches(ctx context.Context, req indexwire.Request, budget projectindex.IndexPatchBudget) ([]projectindex.IndexPatch, error) {
	return w.indexHost().Patches(ctx, req, budget)
}

func (w *Worker) streamCollector(ctx context.Context, req indexwire.Request, budget projectindex.IndexPatchBudget) (*projectindex.ProjectIndexPatchStreamCollector, error) {
	return w.indexHost().Collector(ctx, req, budget)
}

func (w *Worker) streamArtifact(ctx context.Context, req indexwire.Request, artifact projectindex.ProjectIndexArtifactKind) (json.RawMessage, error) {
	return w.indexHost().Artifact(ctx, req, artifact)
}

func (w *Worker) streamRequest(ctx context.Context, req indexwire.Request, handle func(json.RawMessage) error) (nodeworker.StreamResult, error) {
	return w.indexHost().Stream(ctx, req, handle)
}

func (w *Worker) streamPatchRequest(ctx context.Context, req indexwire.Request, handle func(json.RawMessage) error, done func() bool) error {
	return w.indexHost().PatchRequest(ctx, req, handle, done)
}
