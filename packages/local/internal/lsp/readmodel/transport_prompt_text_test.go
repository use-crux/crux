package readmodel

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestAttachTransportPromptTextClassifiesMissingRouteAsUnavailable(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()

	_, err := NewAttachTransport(api.New(server.URL)).PromptText(
		context.Background(),
		PromptTextRequest{File: "writer.ts", LanguageID: "typescript"},
	)
	if !errors.Is(err, ErrPromptTextUnavailable) {
		t.Fatalf("missing route error = %v, want ErrPromptTextUnavailable", err)
	}
}

func TestAttachTransportPromptTextPreservesExactRevision(t *testing.T) {
	revision := staticprotocol.PromptTextDocumentRevision{
		OpenEpoch: 7, Version: 14, SourceHash: "exact-hash",
	}
	want := indexprompttext.Request{
		File: "/repo/src/writer.ts", LanguageID: "typescript",
		Revision: revision, Text: "export const writer = md`# Hello`",
	}
	wantResult := indexprompttext.Result{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            want.File,
		Revision:        revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/project/index/prompt-text" {
			http.NotFound(w, r)
			return
		}
		var got indexprompttext.Request
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil || !reflect.DeepEqual(got, want) {
			t.Errorf("request = %+v, err = %v, want %+v", got, err, want)
		}
		_ = json.NewEncoder(w).Encode(wantResult)
	}))
	defer server.Close()

	result, err := NewAttachTransport(api.New(server.URL)).PromptText(
		context.Background(),
		PromptTextRequest(want),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result, PromptTextResult(wantResult)) {
		t.Fatalf("result = %+v, want %+v", result, wantResult)
	}
}
