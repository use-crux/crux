package source

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/node"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
)

const staticFallbackTimeout = 30 * time.Second

// Client is the shared Project Index phase client for TypeScript worker lanes.
//
// Each phase supplies its worker name, script, producer identity, and transport
// limits, while Client owns the common V2 JSON-line batching, stream
// collection, artifact handling, and source-only fallback behavior.
type Client struct {
	Name           string
	ScriptContent  []byte
	ScriptPath     string
	Worker         *workerproc.Worker
	MaxLineBytes   int
	MaxStreamBytes int
	Producer       string
}

// SourceOnlyArtifactFallback retries an artifact request in source-only mode
// after a richer config-policy request fails.
func (c Client) SourceOnlyArtifactFallback(
	ctx context.Context,
	req requestwire.Request,
	artifact projectindex.ProjectIndexArtifactKind,
	cause error,
) (json.RawMessage, error) {
	timeout := staticFallbackTimeout
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
	resp, err := c.Artifact(fallbackCtx, req, artifact)
	if err != nil {
		return nil, fmt.Errorf("project index source-only fallback after worker failure (%s): %w", cause.Error(), err)
	}
	return resp, nil
}

// Patches streams one phase request and returns the completed Project Index patches.
func (c Client) Patches(ctx context.Context, req requestwire.Request, budget projectindex.IndexPatchBudget) ([]projectindex.IndexPatch, error) {
	collector, err := c.Collector(ctx, req, budget)
	if err != nil {
		return nil, err
	}
	return collector.Patches()
}

// Collector streams one phase request and returns the populated patch collector
// so callers can inspect phase timings or incremental reports.
func (c Client) Collector(
	ctx context.Context,
	req requestwire.Request,
	budget projectindex.IndexPatchBudget,
) (*projectindex.ProjectIndexPatchStreamCollector, error) {
	collector := projectindex.NewProjectIndexPatchStreamCollector(projectindex.ProjectIndexPatchStreamOptions{
		Root:             req.Root,
		Budget:           budget,
		MaxBytes:         c.MaxStreamBytes,
		MaxFactsPerBatch: requestwire.MaxFactsPerBatch(req.Method),
		Producer:         c.Producer,
	})
	err := c.PatchRequest(ctx, req, collector.Handle, func() bool {
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

// Artifact streams an artifact request through a one-shot worker invocation.
func (c Client) Artifact(ctx context.Context, req requestwire.Request, artifact projectindex.ProjectIndexArtifactKind) (json.RawMessage, error) {
	collector := projectindex.NewProjectIndexArtifactStreamCollector(projectindex.ProjectIndexArtifactStreamOptions{
		Root:     req.Root,
		Artifact: artifact,
		MaxBytes: c.MaxStreamBytes,
	})
	result, err := c.Stream(ctx, req, collector.Handle)
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

// Stream sends a single JSON-line request to a one-shot TypeScript worker.
func (c Client) Stream(ctx context.Context, req requestwire.Request, handle func(json.RawMessage) error) (workerproc.StreamResult, error) {
	req.ProtocolVersion = 2
	data, err := json.Marshal(req)
	if err != nil {
		return workerproc.StreamResult{}, fmt.Errorf("marshal streamed project index request: %w", err)
	}
	data = append(data, '\n')
	return node.Stream(ctx, node.Script{
		Name:     c.Name,
		Content:  c.ScriptContent,
		Path:     c.ScriptPath,
		MaxBytes: c.MaxLineBytes,
	}, data, handle)
}

// PatchRequest streams a possibly chunked request batch through a persistent
// TypeScript worker and stops once done reports the phase has completed.
func (c Client) PatchRequest(
	ctx context.Context,
	req requestwire.Request,
	handle func(json.RawMessage) error,
	done func() bool,
) error {
	req.ProtocolVersion = 2
	requests, err := requestwire.Batch(req)
	if err != nil {
		return err
	}
	return node.StreamBatch(ctx, c.Worker, requests, handle, done)
}
