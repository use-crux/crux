package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextRouteMatchesDirectAnalyzerResultBytes(t *testing.T) {
	t.Parallel()

	request := indexprompttext.Request{
		File: "/repo/src/writer.ts", LanguageID: "typescript",
		Revision: staticprotocol.PromptTextDocumentRevision{
			OpenEpoch: 2, Version: 7, SourceHash: "hash",
		},
		Text: "md`# Hello`",
	}
	analyzer := promptTextRouteAnalyzer{result: indexprompttext.Result{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            request.File,
		Revision:        request.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{},
	}}
	direct, err := analyzer.Analyze(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := json.Marshal(direct)
	body, _ := json.Marshal(request)
	response := httptest.NewRecorder()

	New(Options{PromptText: analyzer}).ServeHTTP(
		response,
		httptest.NewRequest(
			http.MethodPost,
			"/api/project/index/prompt-text",
			bytes.NewReader(body),
		),
	)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if got := bytes.TrimSpace(response.Body.Bytes()); !bytes.Equal(got, want) {
		t.Fatalf("HTTP result = %s, direct = %s", got, want)
	}
}

func TestPromptTextRoutePreservesTheDirectSourceBoundAfterJSONEscaping(t *testing.T) {
	t.Parallel()

	source := strings.Repeat("\x00", indexprompttext.MaxDocumentBytes)
	request := indexprompttext.Request{
		File: "/repo/src/writer.ts", LanguageID: "typescript",
		Revision: staticprotocol.PromptTextDocumentRevision{
			OpenEpoch: 2, Version: 7, SourceHash: "hash",
		},
		Text: source,
	}
	body, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	analyzer := &capturingPromptTextRouteAnalyzer{
		result: indexprompttext.Result{
			ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
			File:            request.File,
			Revision:        request.Revision,
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusUnsupported,
			},
			Templates: []staticprotocol.PromptTextTemplate{},
		},
	}
	response := httptest.NewRecorder()

	New(Options{PromptText: analyzer}).ServeHTTP(
		response,
		httptest.NewRequest(
			http.MethodPost,
			"/api/project/index/prompt-text",
			bytes.NewReader(body),
		),
	)
	if response.Code != http.StatusOK {
		t.Fatalf(
			"escaped max-size source status = %d, body bytes = %d",
			response.Code,
			len(body),
		)
	}
	if analyzer.request.Text != source {
		t.Fatalf("attached source bytes changed across JSON transport")
	}
}

func TestPromptTextRouteDoesNotReflectOrLogUnsavedSource(t *testing.T) {
	t.Parallel()

	const secret = "private-unsaved-prompt-text-secret"
	var logs bytes.Buffer
	body, _ := json.Marshal(indexprompttext.Request{
		File: "writer.ts", LanguageID: "typescript", Text: secret,
	})
	response := httptest.NewRecorder()
	New(Options{
		Logger: slog.New(slog.NewTextHandler(&logs, nil)),
		PromptText: promptTextRouteAnalyzer{
			err: errors.New("compiler rejected " + secret),
		},
	}).ServeHTTP(response, httptest.NewRequest(
		http.MethodPost,
		"/api/project/index/prompt-text",
		bytes.NewReader(body),
	))

	if response.Code != http.StatusServiceUnavailable ||
		strings.Contains(response.Body.String(), secret) ||
		strings.Contains(logs.String(), secret) {
		t.Fatalf(
			"response/logs leaked source: status=%d body=%q logs=%q",
			response.Code,
			response.Body.String(),
			logs.String(),
		)
	}
}

type promptTextRouteAnalyzer struct {
	result indexprompttext.Result
	err    error
}

type capturingPromptTextRouteAnalyzer struct {
	request indexprompttext.Request
	result  indexprompttext.Result
}

func (a *capturingPromptTextRouteAnalyzer) Analyze(
	_ context.Context,
	request indexprompttext.Request,
) (indexprompttext.Result, error) {
	a.request = request
	return a.result, nil
}

func (a promptTextRouteAnalyzer) Analyze(
	context.Context,
	indexprompttext.Request,
) (indexprompttext.Result, error) {
	return a.result, a.err
}
