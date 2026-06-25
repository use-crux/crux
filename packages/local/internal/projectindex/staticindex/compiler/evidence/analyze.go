package evidence

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

type Analyzer interface {
	NativeStaticAnalyzeStream(context.Context, protocol.AnalyzeRequest, protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error)
}

type FetchFunc func(context.Context, []json.RawMessage) ([]json.RawMessage, error)

type Result struct {
	Analyze     protocol.AnalyzeResponse
	Facts       []json.RawMessage
	NodeStarted bool
}

type result struct {
	facts []json.RawMessage
	err   error
}

func Analyze(ctx context.Context, analyzer Analyzer, request protocol.AnalyzeRequest, fetch FetchFunc) (Result, error) {
	request.Stream = true
	evidenceResults := []<-chan result{}
	startEvidence := func(jobs []json.RawMessage) error {
		if len(jobs) == 0 {
			return nil
		}
		if fetch == nil {
			return fmt.Errorf("static evidence fetcher is not configured")
		}
		resultC := make(chan result, 1)
		evidenceResults = append(evidenceResults, resultC)
		jobs = protocol.AppendRawMessages(nil, jobs)
		go func() {
			facts, err := fetch(ctx, jobs)
			resultC <- result{facts: facts, err: err}
		}()
		return nil
	}

	analyze, err := analyzer.NativeStaticAnalyzeStream(ctx, request, func(event protocol.AnalyzeStreamEvent) error {
		if event.Type == "extensionEvidenceJobs" {
			return startEvidence(event.ExtensionEvidenceJobs)
		}
		return nil
	})
	if err != nil {
		return Result{NodeStarted: len(evidenceResults) > 0}, err
	}

	extensionFacts := []json.RawMessage{}
	for _, resultC := range evidenceResults {
		evidence := <-resultC
		if evidence.err != nil {
			return Result{Analyze: analyze, NodeStarted: true}, evidence.err
		}
		extensionFacts = protocol.AppendRawMessages(extensionFacts, evidence.facts)
	}
	return Result{
		Analyze:     analyze,
		Facts:       extensionFacts,
		NodeStarted: len(evidenceResults) > 0,
	}, nil
}
