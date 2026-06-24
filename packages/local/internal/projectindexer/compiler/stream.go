package compiler

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
)

func (w *Worker) NativeStaticAnalyzeStream(
	ctx context.Context,
	request staticprotocol.AnalyzeRequest,
	handle staticprotocol.AnalyzeStreamHandler,
) (staticprotocol.AnalyzeResponse, error) {
	if w == nil || w.Process() == nil {
		return staticprotocol.AnalyzeResponse{}, fmt.Errorf("project native static compiler is not configured")
	}
	id := w.NextID()
	request.ID = id
	request.Stream = true

	var response staticprotocol.AnalyzeResponse
	done := false
	err := nodeworker.StreamCall(ctx, w.Process(), request, func(raw json.RawMessage) (bool, error) {
		event, err := staticprotocol.DecodeAnalyzeStreamEvent(raw)
		if err != nil {
			return false, err
		}
		if event.ID != id {
			return false, fmt.Errorf("native static analyze stream response id %d, want %d", event.ID, id)
		}
		if !event.OK {
			return false, staticprotocol.AnalyzeStreamError(event.Error)
		}
		switch event.Type {
		case "fact":
			response.Facts = staticprotocol.AppendRawMessage(response.Facts, event.Fact)
			response.Facts = staticprotocol.AppendRawMessages(response.Facts, event.Facts)
		case "diagnostics":
			response.Diagnostics = staticprotocol.AppendRawMessages(response.Diagnostics, event.Diagnostics)
		case "extensionEvidenceJobs":
			response.ExtensionEvidenceJobs = staticprotocol.AppendRawMessages(response.ExtensionEvidenceJobs, event.ExtensionEvidenceJobs)
		case "done":
			if event.Response == nil {
				return false, fmt.Errorf("native static analyze stream done event missing response")
			}
			stage := *event.Response
			if err := staticprotocol.ValidateResponse(stage.ProtocolVersion, stage.Method, staticprotocol.AnalyzeMethod); err != nil {
				return false, err
			}
			response.ProtocolVersion = stage.ProtocolVersion
			response.Method = stage.Method
			response.Telemetry = stage.Telemetry
			done = true
		default:
			return false, fmt.Errorf("native static analyze stream returned unknown event type %q", event.Type)
		}
		if handle != nil {
			if err := handle(event); err != nil {
				return false, err
			}
		}
		return done, nil
	})
	if err != nil {
		return staticprotocol.AnalyzeResponse{}, err
	}
	if !done {
		return staticprotocol.AnalyzeResponse{}, fmt.Errorf("native static analyze stream ended before done event")
	}
	return response, nil
}

func (p *Pool) NativeStaticAnalyzeStream(
	ctx context.Context,
	request staticprotocol.AnalyzeRequest,
	handle staticprotocol.AnalyzeStreamHandler,
) (staticprotocol.AnalyzeResponse, error) {
	worker, err := p.compilerWorker()
	if err != nil {
		return staticprotocol.AnalyzeResponse{}, err
	}
	return worker.NativeStaticAnalyzeStream(ctx, request, handle)
}

func (w *Worker) NativeStaticFinalizeStream(
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

func (p *Pool) NativeStaticFinalizeStream(
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

func (w *Worker) NativeStaticCompileStream(
	ctx context.Context,
	request staticprotocol.CompileRequest,
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
			return false, fmt.Errorf("native static compile stream response id %d, want %d", event.ID, id)
		}
		if !event.OK {
			return false, staticprotocol.FinalizeStreamError(event.Error)
		}
		switch event.Type {
		case "event":
			if len(event.Event) == 0 {
				return false, fmt.Errorf("native static compile stream event missing project index event")
			}
			if handle != nil {
				if err := handle(event); err != nil {
					return false, err
				}
			}
		case "done":
			if event.Response == nil {
				return false, fmt.Errorf("native static compile stream done event missing response")
			}
			stage := *event.Response
			if err := staticprotocol.ValidateResponse(stage.ProtocolVersion, stage.Method, staticprotocol.CompileMethod); err != nil {
				return false, err
			}
			response = stage
			response.Events = nil
			done = true
		default:
			return false, fmt.Errorf("native static compile stream returned unknown event type %q", event.Type)
		}
		return done, nil
	})
	if err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	if !done {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("native static compile stream ended before done event")
	}
	return response, nil
}

func (p *Pool) NativeStaticCompileStream(
	ctx context.Context,
	request staticprotocol.CompileRequest,
	handle staticprotocol.FinalizeStreamHandler,
) (staticprotocol.FinalizeResponse, error) {
	worker, err := p.compilerWorker()
	if err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	return worker.NativeStaticCompileStream(ctx, request, handle)
}
