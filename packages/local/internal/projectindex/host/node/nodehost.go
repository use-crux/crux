package node

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
)

// Script describes a TypeScript worker script and its per-line response limit.
type Script struct {
	Name     string
	Content  []byte
	Path     string
	MaxBytes int
}

// NewWorker creates a lazy persistent Node worker for a Project Index phase.
func NewWorker(name string, content []byte, scriptPath string, maxBytes int) *workerproc.Worker {
	options := []workerproc.Option{workerproc.WithMaxResponseBytes(maxBytes)}
	if scriptPath != "" {
		options = append(options, workerproc.WithScriptPath(scriptPath))
	}
	return workerproc.New(workerproc.Script{Name: name, Content: content}, options...)
}

// Stream runs a one-shot Node worker and passes each JSON event to handle.
func Stream(ctx context.Context, script Script, input []byte, handle func(json.RawMessage) error) (workerproc.StreamResult, error) {
	return workerproc.Stream(ctx, workerproc.OneShot{
		Script: workerproc.Script{
			Name:    script.Name,
			Content: script.Content,
		},
		ScriptPath:   script.Path,
		Input:        input,
		MaxLineBytes: script.MaxBytes,
	}, handle)
}

// StreamBatch sends a chunked request batch through a persistent Node worker.
func StreamBatch(
	ctx context.Context,
	worker *workerproc.Worker,
	requests []any,
	handle func(json.RawMessage) error,
	done func() bool,
) error {
	return workerproc.StreamCallBatch(ctx, worker, requests, func(raw json.RawMessage) (bool, error) {
		if err := handle(raw); err != nil {
			return false, err
		}
		return done(), nil
	})
}
