package host

import (
	"context"
	"encoding/json"

	nodeprocess "github.com/use-crux/crux/packages/local/internal/process/node"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/client"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/indexwire"
)

func (w *Bundle) indexHost() client.Client {
	return client.Client{
		Name:          "project-indexer",
		ScriptContent: w.scriptContent,
		ScriptPath:    w.scriptPath,
		Worker:        w.worker,
		MaxBytes:      workerMaxResponseBytes,
		Producer:      workerProducer,
	}
}

func (w *Bundle) sourceOnlyArtifactFallback(ctx context.Context, req indexwire.Request, artifact projectindex.ProjectIndexArtifactKind, cause error) (json.RawMessage, error) {
	return w.indexHost().SourceOnlyArtifactFallback(ctx, req, artifact, cause)
}

func (w *Bundle) streamPatches(ctx context.Context, req indexwire.Request, budget projectindex.IndexPatchBudget) ([]projectindex.IndexPatch, error) {
	return w.indexHost().Patches(ctx, req, budget)
}

func (w *Bundle) streamCollector(ctx context.Context, req indexwire.Request, budget projectindex.IndexPatchBudget) (*projectindex.ProjectIndexPatchStreamCollector, error) {
	return w.indexHost().Collector(ctx, req, budget)
}

func (w *Bundle) streamArtifact(ctx context.Context, req indexwire.Request, artifact projectindex.ProjectIndexArtifactKind) (json.RawMessage, error) {
	return w.indexHost().Artifact(ctx, req, artifact)
}

func (w *Bundle) streamRequest(ctx context.Context, req indexwire.Request, handle func(json.RawMessage) error) (nodeprocess.StreamResult, error) {
	return w.indexHost().Stream(ctx, req, handle)
}

func (w *Bundle) streamPatchRequest(ctx context.Context, req indexwire.Request, handle func(json.RawMessage) error, done func() bool) error {
	return w.indexHost().PatchRequest(ctx, req, handle, done)
}
