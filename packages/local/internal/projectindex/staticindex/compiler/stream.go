package compiler

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func (w *Worker) StaticIndexAnalyzeStream(
	ctx context.Context,
	request protocol.AnalyzeRequest,
	handle protocol.AnalyzeStreamHandler,
) (protocol.AnalyzeResponse, error) {
	if w == nil || w.Process() == nil {
		return protocol.AnalyzeResponse{}, fmt.Errorf("project Static Index compiler is not configured")
	}
	id := w.NextID()
	request.ID = id
	request.Stream = true

	var response protocol.AnalyzeResponse
	done := false
	err := workerproc.StreamCall(ctx, w.Process(), request, func(raw json.RawMessage) (bool, error) {
		event, err := protocol.DecodeAnalyzeStreamEvent(raw)
		if err != nil {
			return false, err
		}
		if event.ID != id {
			return false, fmt.Errorf("Static Index analyze stream response id %d, want %d", event.ID, id)
		}
		if !event.OK {
			return false, protocol.AnalyzeStreamError(event.Error)
		}
		switch event.Type {
		case "fact":
			response.Facts = protocol.AppendRawMessage(response.Facts, event.Fact)
			response.Facts = protocol.AppendRawMessages(response.Facts, event.Facts)
		case "diagnostics":
			response.Diagnostics = protocol.AppendRawMessages(response.Diagnostics, event.Diagnostics)
		case "extensionEvidenceJobs":
			response.ExtensionEvidenceJobs = protocol.AppendRawMessages(response.ExtensionEvidenceJobs, event.ExtensionEvidenceJobs)
		case "done":
			if event.Response == nil {
				return false, fmt.Errorf("Static Index analyze stream done event missing response")
			}
			stage := *event.Response
			if err := protocol.ValidateResponse(stage.ProtocolVersion, stage.Method, protocol.AnalyzeMethod); err != nil {
				return false, err
			}
			response.ProtocolVersion = stage.ProtocolVersion
			response.Method = stage.Method
			response.Telemetry = stage.Telemetry
			done = true
		default:
			return false, fmt.Errorf("Static Index analyze stream returned unknown event type %q", event.Type)
		}
		if handle != nil {
			if err := handle(event); err != nil {
				return false, err
			}
		}
		return done, nil
	})
	if err != nil {
		return protocol.AnalyzeResponse{}, err
	}
	if !done {
		return protocol.AnalyzeResponse{}, fmt.Errorf("Static Index analyze stream ended before done event")
	}
	return response, nil
}

func (p *Pool) StaticIndexAnalyzeStream(
	ctx context.Context,
	request protocol.AnalyzeRequest,
	handle protocol.AnalyzeStreamHandler,
) (protocol.AnalyzeResponse, error) {
	worker, err := p.staticIndexWorker()
	if err != nil {
		return protocol.AnalyzeResponse{}, err
	}
	return worker.StaticIndexAnalyzeStream(ctx, request, handle)
}

func (w *Worker) StaticIndexFinalizeStream(
	ctx context.Context,
	request protocol.FinalizeRequest,
	handle protocol.FinalizeStreamHandler,
) (protocol.FinalizeResponse, error) {
	if w == nil || w.Process() == nil {
		return protocol.FinalizeResponse{}, fmt.Errorf("project Static Index compiler is not configured")
	}
	id := w.NextID()
	request.ID = id
	request.Stream = true

	var response protocol.FinalizeResponse
	done := false
	err := workerproc.StreamCall(ctx, w.Process(), request, func(raw json.RawMessage) (bool, error) {
		event, err := protocol.DecodeFinalizeStreamEvent(raw)
		if err != nil {
			return false, err
		}
		if event.ID != id {
			return false, fmt.Errorf("Static Index finalize stream response id %d, want %d", event.ID, id)
		}
		if !event.OK {
			return false, protocol.FinalizeStreamError(event.Error)
		}
		switch event.Type {
		case "event":
			if len(event.Event) == 0 {
				return false, fmt.Errorf("Static Index finalize stream event missing project index event")
			}
			if handle != nil {
				if err := handle(event); err != nil {
					return false, err
				}
			}
		case "done":
			if event.Response == nil {
				return false, fmt.Errorf("Static Index finalize stream done event missing response")
			}
			stage := *event.Response
			if err := protocol.ValidateResponse(stage.ProtocolVersion, stage.Method, protocol.FinalizeMethod); err != nil {
				return false, err
			}
			response = stage
			response.Events = nil
			done = true
		default:
			return false, fmt.Errorf("Static Index finalize stream returned unknown event type %q", event.Type)
		}
		return done, nil
	})
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	if !done {
		return protocol.FinalizeResponse{}, fmt.Errorf("Static Index finalize stream ended before done event")
	}
	return response, nil
}

func (p *Pool) StaticIndexFinalizeStream(
	ctx context.Context,
	request protocol.FinalizeRequest,
	handle protocol.FinalizeStreamHandler,
) (protocol.FinalizeResponse, error) {
	worker, err := p.staticIndexWorker()
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return worker.StaticIndexFinalizeStream(ctx, request, handle)
}

func (w *Worker) StaticIndexCompileStream(
	ctx context.Context,
	request protocol.CompileRequest,
	handle protocol.FinalizeStreamHandler,
) (protocol.FinalizeResponse, error) {
	if w == nil || w.Process() == nil {
		return protocol.FinalizeResponse{}, fmt.Errorf("project Static Index compiler is not configured")
	}
	id := w.NextID()
	request.ID = id
	request.Stream = true

	var response protocol.FinalizeResponse
	done := false
	err := workerproc.StreamCall(ctx, w.Process(), request, func(raw json.RawMessage) (bool, error) {
		event, err := protocol.DecodeFinalizeStreamEvent(raw)
		if err != nil {
			return false, err
		}
		if event.ID != id {
			return false, fmt.Errorf("Static Index compile stream response id %d, want %d", event.ID, id)
		}
		if !event.OK {
			return false, protocol.FinalizeStreamError(event.Error)
		}
		switch event.Type {
		case "event":
			if len(event.Event) == 0 {
				return false, fmt.Errorf("Static Index compile stream event missing project index event")
			}
			if handle != nil {
				if err := handle(event); err != nil {
					return false, err
				}
			}
		case "done":
			if event.Response == nil {
				return false, fmt.Errorf("Static Index compile stream done event missing response")
			}
			stage := *event.Response
			if err := protocol.ValidateResponse(stage.ProtocolVersion, stage.Method, protocol.CompileMethod); err != nil {
				return false, err
			}
			response = stage
			response.Events = nil
			done = true
		default:
			return false, fmt.Errorf("Static Index compile stream returned unknown event type %q", event.Type)
		}
		return done, nil
	})
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	if !done {
		return protocol.FinalizeResponse{}, fmt.Errorf("Static Index compile stream ended before done event")
	}
	return response, nil
}

func (p *Pool) StaticIndexCompileStream(
	ctx context.Context,
	request protocol.CompileRequest,
	handle protocol.FinalizeStreamHandler,
) (protocol.FinalizeResponse, error) {
	worker, err := p.staticIndexWorker()
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return worker.StaticIndexCompileStream(ctx, request, handle)
}
