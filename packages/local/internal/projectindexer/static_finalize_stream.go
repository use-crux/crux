package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
)

func (w *syntaxCompilerWorker) NativeStaticFinalizeStream(
	ctx context.Context,
	request staticprotocol.FinalizeRequest,
	handle staticprotocol.FinalizeStreamHandler,
) (staticprotocol.FinalizeResponse, error) {
	if w == nil || w.Process() == nil {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("project native static compiler is not configured")
	}
	id := w.NextID()
	request.ID = id
	request.Stream = true

	var response staticprotocol.FinalizeResponse
	done := false
	err := nodeworker.StreamCall(ctx, w.Process(), request, func(raw json.RawMessage) (bool, error) {
		event, err := staticprotocol.DecodeFinalizeStreamEvent(raw)
		if err != nil {
			return false, err
		}
		if event.ID != id {
			return false, fmt.Errorf("native static finalize stream response id %d, want %d", event.ID, id)
		}
		if !event.OK {
			return false, staticprotocol.FinalizeStreamError(event.Error)
		}
		switch event.Type {
		case "event":
			if len(event.Event) == 0 {
				return false, fmt.Errorf("native static finalize stream event missing project index event")
			}
			if handle != nil {
				if err := handle(event); err != nil {
					return false, err
				}
			}
		case "done":
			if event.Response == nil {
				return false, fmt.Errorf("native static finalize stream done event missing response")
			}
			stage := *event.Response
			if err := staticprotocol.ValidateResponse(stage.ProtocolVersion, stage.Method, staticprotocol.FinalizeMethod); err != nil {
				return false, err
			}
			response = stage
			response.Events = nil
			done = true
		default:
			return false, fmt.Errorf("native static finalize stream returned unknown event type %q", event.Type)
		}
		return done, nil
	})
	if err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	if !done {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("native static finalize stream ended before done event")
	}
	return response, nil
}

func (p *syntaxCompilerPool) NativeStaticFinalizeStream(
	ctx context.Context,
	request staticprotocol.FinalizeRequest,
	handle staticprotocol.FinalizeStreamHandler,
) (staticprotocol.FinalizeResponse, error) {
	worker, err := p.compilerWorker()
	if err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	return worker.NativeStaticFinalizeStream(ctx, request, handle)
}

func projectNativeStaticPatchFromFinalizeStream(
	ctx context.Context,
	root string,
	compiler StaticCompiler,
	request staticprotocol.FinalizeRequest,
) (devtools.IndexPatch, []devtools.ProjectIndexPhaseTiming, bool, staticprotocol.FinalizeResponse, error) {
	request.Stream = true
	collector := devtools.NewProjectIndexPatchStreamCollector(devtools.ProjectIndexPatchStreamOptions{
		Root:             root,
		Budget:           devtools.IndexPatchBudget{},
		MaxBytes:         workerMaxResponseBytes,
		MaxFactsPerBatch: maxFactsPerBatch("indexProjectAst"),
		Producer:         workerProducer,
	})
	eventCount := 0
	response, err := compiler.NativeStaticFinalizeStream(ctx, request, func(event staticprotocol.FinalizeStreamEvent) error {
		eventCount++
		return collector.Handle(event.Event)
	})
	if err != nil {
		return devtools.IndexPatch{}, nil, false, response, err
	}
	if eventCount == 0 {
		return devtools.IndexPatch{}, nil, false, response, nil
	}

	result, err := collector.IncrementalResult()
	if err != nil {
		return devtools.IndexPatch{}, nil, false, response, fmt.Errorf("native static finalize event stream: %w", err)
	}
	patches := result.Patches
	if len(patches) != 1 {
		return devtools.IndexPatch{}, nil, false, response, fmt.Errorf("native static finalize returned %d patches, want 1", len(patches))
	}
	return patches[0], collector.Timings(), projectNativeStaticFinalizeComplete(result.Decision), response, nil
}
