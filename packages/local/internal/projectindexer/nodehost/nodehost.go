package nodehost

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

type Script struct {
	Name     string
	Content  []byte
	Path     string
	MaxBytes int
}

func NewWorker(name string, content []byte, scriptPath string, maxBytes int) *nodeworker.Worker {
	options := []nodeworker.Option{nodeworker.WithMaxResponseBytes(maxBytes)}
	if scriptPath != "" {
		options = append(options, nodeworker.WithScriptPath(scriptPath))
	}
	return nodeworker.New(nodeworker.Script{Name: name, Content: content}, options...)
}

func Stream(ctx context.Context, script Script, input []byte, handle func(json.RawMessage) error) (nodeworker.StreamResult, error) {
	return nodeworker.Stream(ctx, nodeworker.OneShot{
		Script: nodeworker.Script{
			Name:    script.Name,
			Content: script.Content,
		},
		ScriptPath:   script.Path,
		Input:        input,
		MaxLineBytes: script.MaxBytes,
	}, handle)
}

func StreamBatch(
	ctx context.Context,
	worker *nodeworker.Worker,
	requests []any,
	handle func(json.RawMessage) error,
	done func() bool,
) error {
	return nodeworker.StreamCallBatch(ctx, worker, requests, func(raw json.RawMessage) (bool, error) {
		if err := handle(raw); err != nil {
			return false, err
		}
		return done(), nil
	})
}
