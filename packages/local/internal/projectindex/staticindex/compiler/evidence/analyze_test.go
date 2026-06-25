package evidence

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestAnalyzeCollectsExtensionEvidenceJobs(t *testing.T) {
	analyzer := &recordingAnalyzer{
		events: []protocol.AnalyzeStreamEvent{
			{
				Type:                  "extensionEvidenceJobs",
				ExtensionEvidenceJobs: []json.RawMessage{json.RawMessage(`{"id":"job:one"}`)},
			},
		},
		response: protocol.AnalyzeResponse{
			Facts: []json.RawMessage{json.RawMessage(`{"definition":"native"}`)},
		},
	}
	fetchCalls := 0

	result, err := Analyze(context.Background(), analyzer, protocol.AnalyzeRequest{}, func(_ context.Context, jobs []json.RawMessage) ([]json.RawMessage, error) {
		fetchCalls++
		if len(jobs) != 1 || string(jobs[0]) != `{"id":"job:one"}` {
			return nil, fmt.Errorf("jobs = %s, want copied job", jobs)
		}
		jobs[0][0] = '['
		return []json.RawMessage{json.RawMessage(`{"extension":"fact"}`)}, nil
	})

	if err != nil {
		t.Fatalf("Analyze error = %v", err)
	}
	if !analyzer.stream {
		t.Fatal("request stream flag = false, want true")
	}
	if fetchCalls != 1 || !result.NodeStarted {
		t.Fatalf("fetchCalls = %d nodeStarted = %v, want one evidence fetch", fetchCalls, result.NodeStarted)
	}
	if len(result.Analyze.Facts) != 1 || string(result.Analyze.Facts[0]) != `{"definition":"native"}` {
		t.Fatalf("native facts = %s, want analyzer response facts", result.Analyze.Facts)
	}
	if len(result.Facts) != 1 || string(result.Facts[0]) != `{"extension":"fact"}` {
		t.Fatalf("extension facts = %s, want fetched facts", result.Facts)
	}
	if string(analyzer.events[0].ExtensionEvidenceJobs[0]) != `{"id":"job:one"}` {
		t.Fatalf("event jobs mutated: %s", analyzer.events[0].ExtensionEvidenceJobs)
	}
}

func TestAnalyzeReportsEvidenceFetchErrorAfterAnalyzeCompletes(t *testing.T) {
	analyzer := &recordingAnalyzer{
		events: []protocol.AnalyzeStreamEvent{
			{
				Type:                  "extensionEvidenceJobs",
				ExtensionEvidenceJobs: []json.RawMessage{json.RawMessage(`{"id":"job:one"}`)},
			},
		},
		response: protocol.AnalyzeResponse{
			Facts: []json.RawMessage{json.RawMessage(`{"definition":"native"}`)},
		},
	}

	result, err := Analyze(context.Background(), analyzer, protocol.AnalyzeRequest{}, func(context.Context, []json.RawMessage) ([]json.RawMessage, error) {
		return nil, fmt.Errorf("evidence failed")
	})

	if err == nil || err.Error() != "evidence failed" {
		t.Fatalf("Analyze error = %v, want evidence failure", err)
	}
	if !result.NodeStarted {
		t.Fatal("nodeStarted = false, want evidence node marked")
	}
	if len(result.Analyze.Facts) != 1 {
		t.Fatalf("analyze response = %+v, want native response preserved", result.Analyze)
	}
}

type recordingAnalyzer struct {
	stream   bool
	events   []protocol.AnalyzeStreamEvent
	response protocol.AnalyzeResponse
}

func (a *recordingAnalyzer) NativeStaticAnalyzeStream(_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	a.stream = request.Stream
	for _, event := range a.events {
		if err := handle(event); err != nil {
			return protocol.AnalyzeResponse{}, err
		}
	}
	return a.response, nil
}
