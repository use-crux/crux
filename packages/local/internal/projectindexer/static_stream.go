package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
)

type projectNativeStaticEvidenceResult struct {
	facts []json.RawMessage
	err   error
}

func (w *syntaxCompilerWorker) NativeStaticAnalyzeStream(
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

func (p *syntaxCompilerPool) NativeStaticAnalyzeStream(
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

func (w *Worker) projectNativeStaticAnalyzeWithExtensionFacts(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	compiler StaticCompiler,
	request staticprotocol.AnalyzeRequest,
) (staticprotocol.AnalyzeResponse, []json.RawMessage, bool, error) {
	request.Stream = true
	evidenceResults := []<-chan projectNativeStaticEvidenceResult{}
	startEvidence := func(jobs []json.RawMessage) {
		if len(jobs) == 0 {
			return
		}
		result := make(chan projectNativeStaticEvidenceResult, 1)
		evidenceResults = append(evidenceResults, result)
		jobs = staticprotocol.AppendRawMessages(nil, jobs)
		go func() {
			facts, err := w.projectNativeStaticExtensionEvidenceFacts(ctx, root, configPath, projectName, jobs)
			result <- projectNativeStaticEvidenceResult{facts: facts, err: err}
		}()
	}

	var analyze staticprotocol.AnalyzeResponse
	analyze, err := compiler.NativeStaticAnalyzeStream(ctx, request, func(event staticprotocol.AnalyzeStreamEvent) error {
		if event.Type == "extensionEvidenceJobs" {
			startEvidence(event.ExtensionEvidenceJobs)
		}
		return nil
	})
	if err != nil {
		return staticprotocol.AnalyzeResponse{}, nil, len(evidenceResults) > 0, err
	}

	extensionFacts := []json.RawMessage{}
	for _, result := range evidenceResults {
		evidence := <-result
		if evidence.err != nil {
			return analyze, nil, true, evidence.err
		}
		extensionFacts = staticprotocol.AppendRawMessages(extensionFacts, evidence.facts)
	}
	return analyze, extensionFacts, len(evidenceResults) > 0, nil
}
