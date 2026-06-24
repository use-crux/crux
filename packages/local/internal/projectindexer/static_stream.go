package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

type projectNativeStaticEvidenceResult struct {
	facts []json.RawMessage
	err   error
}

type projectNativeStaticAnalyzeStreamHandler func(projectNativeStaticAnalyzeStreamEvent) error

type projectNativeStaticAnalyzeStreamEvent struct {
	ID                    uint64                              `json:"id"`
	OK                    bool                                `json:"ok"`
	Type                  string                              `json:"type,omitempty"`
	Fact                  json.RawMessage                     `json:"fact,omitempty"`
	Facts                 []json.RawMessage                   `json:"facts,omitempty"`
	Diagnostics           []json.RawMessage                   `json:"diagnostics,omitempty"`
	ExtensionEvidenceJobs []json.RawMessage                   `json:"extensionEvidenceJobs,omitempty"`
	Response              *projectNativeStaticAnalyzeResponse `json:"response,omitempty"`
	Error                 string                              `json:"error,omitempty"`
}

func (w *syntaxCompilerWorker) NativeStaticAnalyzeStream(
	ctx context.Context,
	request projectNativeStaticAnalyzeRequest,
	handle projectNativeStaticAnalyzeStreamHandler,
) (projectNativeStaticAnalyzeResponse, error) {
	if w == nil || w.Process() == nil {
		return projectNativeStaticAnalyzeResponse{}, fmt.Errorf("project native static compiler is not configured")
	}
	id := w.NextID()
	request.ID = id
	request.Stream = true

	var response projectNativeStaticAnalyzeResponse
	done := false
	err := nodeworker.StreamCall(ctx, w.Process(), request, func(raw json.RawMessage) (bool, error) {
		event, err := decodeProjectNativeStaticAnalyzeStreamEvent(raw)
		if err != nil {
			return false, err
		}
		if event.ID != id {
			return false, fmt.Errorf("native static analyze stream response id %d, want %d", event.ID, id)
		}
		if !event.OK {
			return false, nativeStaticAnalyzeStreamError(event.Error)
		}
		switch event.Type {
		case "fact":
			response.Facts = appendRawMessage(response.Facts, event.Fact)
			response.Facts = appendRawMessages(response.Facts, event.Facts)
		case "diagnostics":
			response.Diagnostics = appendRawMessages(response.Diagnostics, event.Diagnostics)
		case "extensionEvidenceJobs":
			response.ExtensionEvidenceJobs = appendRawMessages(response.ExtensionEvidenceJobs, event.ExtensionEvidenceJobs)
		case "done":
			if event.Response == nil {
				return false, fmt.Errorf("native static analyze stream done event missing response")
			}
			stage := *event.Response
			if err := validateProjectNativeStaticResponse(stage.ProtocolVersion, stage.Method, projectNativeStaticAnalyzeMethod); err != nil {
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
		return projectNativeStaticAnalyzeResponse{}, err
	}
	if !done {
		return projectNativeStaticAnalyzeResponse{}, fmt.Errorf("native static analyze stream ended before done event")
	}
	return response, nil
}

func (p *syntaxCompilerPool) NativeStaticAnalyzeStream(
	ctx context.Context,
	request projectNativeStaticAnalyzeRequest,
	handle projectNativeStaticAnalyzeStreamHandler,
) (projectNativeStaticAnalyzeResponse, error) {
	worker, err := p.compilerWorker()
	if err != nil {
		return projectNativeStaticAnalyzeResponse{}, err
	}
	return worker.NativeStaticAnalyzeStream(ctx, request, handle)
}

func decodeProjectNativeStaticAnalyzeStreamEvent(raw json.RawMessage) (projectNativeStaticAnalyzeStreamEvent, error) {
	var event projectNativeStaticAnalyzeStreamEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return projectNativeStaticAnalyzeStreamEvent{}, fmt.Errorf("decode native static analyze stream event: %w", err)
	}
	return event, nil
}

func nativeStaticAnalyzeStreamError(message string) error {
	if message == "" {
		return fmt.Errorf("native static analyze stream failed")
	}
	return fmt.Errorf("native static analyze stream failed: %s", message)
}

func appendRawMessage(values []json.RawMessage, value json.RawMessage) []json.RawMessage {
	if len(value) == 0 {
		return values
	}
	return append(values, append(json.RawMessage(nil), value...))
}

func appendRawMessages(values []json.RawMessage, next []json.RawMessage) []json.RawMessage {
	for _, value := range next {
		values = appendRawMessage(values, value)
	}
	return values
}

func (w *Worker) projectNativeStaticAnalyzeWithExtensionFacts(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	compiler StaticCompiler,
	request projectNativeStaticAnalyzeRequest,
) (projectNativeStaticAnalyzeResponse, []json.RawMessage, bool, error) {
	request.Stream = true
	evidenceResults := []<-chan projectNativeStaticEvidenceResult{}
	startEvidence := func(jobs []json.RawMessage) {
		if len(jobs) == 0 {
			return
		}
		result := make(chan projectNativeStaticEvidenceResult, 1)
		evidenceResults = append(evidenceResults, result)
		jobs = appendRawMessages(nil, jobs)
		go func() {
			facts, err := w.projectNativeStaticExtensionEvidenceFacts(ctx, root, configPath, projectName, jobs)
			result <- projectNativeStaticEvidenceResult{facts: facts, err: err}
		}()
	}

	var analyze projectNativeStaticAnalyzeResponse
	analyze, err := compiler.NativeStaticAnalyzeStream(ctx, request, func(event projectNativeStaticAnalyzeStreamEvent) error {
		if event.Type == "extensionEvidenceJobs" {
			startEvidence(event.ExtensionEvidenceJobs)
		}
		return nil
	})
	if err != nil {
		return projectNativeStaticAnalyzeResponse{}, nil, len(evidenceResults) > 0, err
	}

	extensionFacts := []json.RawMessage{}
	for _, result := range evidenceResults {
		evidence := <-result
		if evidence.err != nil {
			return analyze, nil, true, evidence.err
		}
		extensionFacts = appendRawMessages(extensionFacts, evidence.facts)
	}
	return analyze, extensionFacts, len(evidenceResults) > 0, nil
}
