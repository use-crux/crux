package indexhost

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/indexwire"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/nodehost"
)

const staticFallbackTimeout = 30 * time.Second

type Client struct {
	Name          string
	ScriptContent []byte
	ScriptPath    string
	Worker        *nodeworker.Worker
	MaxBytes      int
	Producer      string
}

func (c Client) SourceOnlyArtifactFallback(
	ctx context.Context,
	req indexwire.Request,
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

func (c Client) Patches(ctx context.Context, req indexwire.Request, budget projectindex.IndexPatchBudget) ([]projectindex.IndexPatch, error) {
	collector, err := c.Collector(ctx, req, budget)
	if err != nil {
		return nil, err
	}
	return collector.Patches()
}

func (c Client) Collector(
	ctx context.Context,
	req indexwire.Request,
	budget projectindex.IndexPatchBudget,
) (*projectindex.ProjectIndexPatchStreamCollector, error) {
	collector := projectindex.NewProjectIndexPatchStreamCollector(projectindex.ProjectIndexPatchStreamOptions{
		Root:             req.Root,
		Budget:           budget,
		MaxBytes:         c.MaxBytes,
		MaxFactsPerBatch: indexwire.MaxFactsPerBatch(req.Method),
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

func (c Client) Artifact(ctx context.Context, req indexwire.Request, artifact projectindex.ProjectIndexArtifactKind) (json.RawMessage, error) {
	collector := projectindex.NewProjectIndexArtifactStreamCollector(projectindex.ProjectIndexArtifactStreamOptions{
		Root:     req.Root,
		Artifact: artifact,
		MaxBytes: c.MaxBytes,
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

func (c Client) Stream(ctx context.Context, req indexwire.Request, handle func(json.RawMessage) error) (nodeworker.StreamResult, error) {
	req.ProtocolVersion = 2
	data, err := json.Marshal(req)
	if err != nil {
		return nodeworker.StreamResult{}, fmt.Errorf("marshal streamed project index request: %w", err)
	}
	data = append(data, '\n')
	return nodehost.Stream(ctx, nodehost.Script{
		Name:     c.Name,
		Content:  c.ScriptContent,
		Path:     c.ScriptPath,
		MaxBytes: c.MaxBytes,
	}, data, handle)
}

func (c Client) PatchRequest(
	ctx context.Context,
	req indexwire.Request,
	handle func(json.RawMessage) error,
	done func() bool,
) error {
	req.ProtocolVersion = 2
	requests, err := indexwire.Batch(req)
	if err != nil {
		return err
	}
	return nodehost.StreamBatch(ctx, c.Worker, requests, handle, done)
}
