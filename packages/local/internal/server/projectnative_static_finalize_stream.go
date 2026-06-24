package server

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

type projectNativeStaticFinalizeStreamHandler func(projectNativeStaticFinalizeStreamEvent) error

type projectNativeStaticFinalizeStreamEvent struct {
	ID       uint64                               `json:"id"`
	OK       bool                                 `json:"ok"`
	Type     string                               `json:"type,omitempty"`
	Event    json.RawMessage                      `json:"event,omitempty"`
	Response *projectNativeStaticFinalizeResponse `json:"response,omitempty"`
	Error    string                               `json:"error,omitempty"`
}

func (w *ProjectIndexerWorkerProcess) NativeStaticFinalizeStream(
	ctx context.Context,
	request projectNativeStaticFinalizeRequest,
	handle projectNativeStaticFinalizeStreamHandler,
) (projectNativeStaticFinalizeResponse, error) {
	if w == nil || w.worker == nil {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("project native static compiler is not configured")
	}
	id := w.nextID.Add(1)
	request.ID = id
	request.Stream = true

	var response projectNativeStaticFinalizeResponse
	done := false
	err := nodeworker.StreamCall(ctx, w.worker, request, func(raw json.RawMessage) (bool, error) {
		event, err := decodeProjectNativeStaticFinalizeStreamEvent(raw)
		if err != nil {
			return false, err
		}
		if event.ID != id {
			return false, fmt.Errorf("native static finalize stream response id %d, want %d", event.ID, id)
		}
		if !event.OK {
			return false, nativeStaticFinalizeStreamError(event.Error)
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
			if err := validateProjectNativeStaticResponse(stage.ProtocolVersion, stage.Method, projectNativeStaticFinalizeMethod); err != nil {
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
		return projectNativeStaticFinalizeResponse{}, err
	}
	if !done {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("native static finalize stream ended before done event")
	}
	return response, nil
}

func (p *ProjectIndexerWorkerPool) NativeStaticFinalizeStream(
	ctx context.Context,
	request projectNativeStaticFinalizeRequest,
	handle projectNativeStaticFinalizeStreamHandler,
) (projectNativeStaticFinalizeResponse, error) {
	worker, err := p.nativeStaticCompilerWorker()
	if err != nil {
		return projectNativeStaticFinalizeResponse{}, err
	}
	return worker.NativeStaticFinalizeStream(ctx, request, handle)
}

func projectNativeStaticPatchFromFinalizeStream(
	ctx context.Context,
	root string,
	compiler ProjectNativeStaticCompiler,
	request projectNativeStaticFinalizeRequest,
) (devtools.IndexPatch, []devtools.ProjectIndexPhaseTiming, bool, projectNativeStaticFinalizeResponse, error) {
	request.Stream = true
	collector := devtools.NewProjectIndexPatchStreamCollector(devtools.ProjectIndexPatchStreamOptions{
		Root:             root,
		Budget:           devtools.IndexPatchBudget{},
		MaxBytes:         projectIndexWorkerMaxResponseBytes,
		MaxFactsPerBatch: projectIndexWorkerMaxFactsPerBatch("indexProjectAst"),
		Producer:         projectIndexWorkerProducer,
	})
	eventCount := 0
	response, err := compiler.NativeStaticFinalizeStream(ctx, request, func(event projectNativeStaticFinalizeStreamEvent) error {
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

func decodeProjectNativeStaticFinalizeStreamEvent(raw json.RawMessage) (projectNativeStaticFinalizeStreamEvent, error) {
	var event projectNativeStaticFinalizeStreamEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return projectNativeStaticFinalizeStreamEvent{}, fmt.Errorf("decode native static finalize stream event: %w", err)
	}
	return event, nil
}

func nativeStaticFinalizeStreamError(message string) error {
	if message == "" {
		return fmt.Errorf("native static finalize stream failed")
	}
	return fmt.Errorf("native static finalize stream failed: %s", message)
}
