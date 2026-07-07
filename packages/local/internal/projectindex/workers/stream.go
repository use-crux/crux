package workers

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/source"
)

func (w *Bundle) sourceClient() source.Client {
	return source.Client{
		Name:           "project-indexer",
		ScriptContent:  w.scriptContent,
		ScriptPath:     w.scriptPath,
		Worker:         w.worker,
		MaxLineBytes:   workerMaxResponseLineBytes,
		MaxStreamBytes: workerMaxResponseStreamBytes,
		Producer:       workerProducer,
	}
}

func (w *Bundle) sourceOnlyArtifactFallback(ctx context.Context, req requestwire.Request, artifact projectindex.ProjectIndexArtifactKind, cause error) (json.RawMessage, error) {
	return w.sourceClient().SourceOnlyArtifactFallback(ctx, req, artifact, cause)
}

func (w *Bundle) streamPatches(ctx context.Context, req requestwire.Request, budget projectindex.IndexPatchBudget) ([]projectindex.IndexPatch, error) {
	return w.sourceClient().Patches(ctx, req, budget)
}

func (w *Bundle) streamCollector(ctx context.Context, req requestwire.Request, budget projectindex.IndexPatchBudget) (*projectindex.ProjectIndexPatchStreamCollector, error) {
	return w.sourceClient().Collector(ctx, req, budget)
}

func (w *Bundle) streamArtifact(ctx context.Context, req requestwire.Request, artifact projectindex.ProjectIndexArtifactKind) (json.RawMessage, error) {
	return w.sourceClient().Artifact(ctx, req, artifact)
}

func (w *Bundle) streamRequest(ctx context.Context, req requestwire.Request, handle func(json.RawMessage) error) (workerproc.StreamResult, error) {
	return w.sourceClient().Stream(ctx, req, handle)
}

func (w *Bundle) streamPatchRequest(ctx context.Context, req requestwire.Request, handle func(json.RawMessage) error, done func() bool) error {
	return w.sourceClient().PatchRequest(ctx, req, handle, done)
}
